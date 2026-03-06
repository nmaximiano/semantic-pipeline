from __future__ import annotations
import asyncio
import json
import uuid
import time
from typing import AsyncGenerator

from agent.llm import tool_completion_stream
from agent.config import TOOLS, SYSTEM_PROMPT, MAX_ROUNDS, CONTEXT_WINDOW, HISTORY_TAIL, AGENT_MODEL
from agent.logger import AgentLogger

_supabase_admin = None

def _get_supabase_admin():
    global _supabase_admin
    if _supabase_admin is None:
        import os
        from supabase import create_client
        _supabase_admin = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    return _supabase_admin


# -- Cancel support -----------------------------------------------------------
_cancel_events: dict[str, asyncio.Event] = {}


def request_cancel(user_id: str) -> bool:
    ev = _cancel_events.get(user_id)
    if ev:
        ev.set()
        return True
    return False


# -- Agent --------------------------------------------------------------------

class Agent:
    def __init__(self, message: str, dataset_context: dict | None,
                 user_id: str, session_id: str,
                 history: list | None = None,
                 other_dataframes: list[dict] | None = None,
                 charge_tokens=None,
                 user_plan: str = "free",
                 model: str = AGENT_MODEL,
                 credits_tracker: list[int] | None = None):
        self.message = message
        self.dataset_context = dataset_context
        self.user_id = user_id
        self.session_id = session_id
        self.charge_tokens = charge_tokens  # callable(round, input_tok, output_tok) -> bool
        self.user_plan = user_plan
        self.model = model
        self.credits_tracker = credits_tracker or [0]

        self.alog = AgentLogger()
        self.ds_context = self._build_dataset_context(dataset_context, history, other_dataframes)

        self.cancel = asyncio.Event()
        if user_id:
            _cancel_events[user_id] = self.cancel

        self.result_queues: dict[str, asyncio.Queue] = {}
        self.final_response = ""
        self.current_plan: list[dict] | None = None
        self._cleaned_up = False

    @staticmethod
    def _build_dataset_context(dataset_context: dict | None,
                               history: list | None,
                               other_dataframes: list[dict] | None = None) -> dict:
        ctx: dict = {}
        if dataset_context:
            ctx["active_dataset"] = dataset_context
        if other_dataframes:
            ctx["other_datasets"] = other_dataframes
        if history:
            # Only keep the last HISTORY_TAIL turns to avoid bloating the system prompt.
            # The agent's own tool-call loop provides immediate context.
            ctx["conversation_history"] = history[-HISTORY_TAIL:]
        return ctx

    def _build_system_message(self) -> str:
        sys: dict = {
            "role": "data_assistant",
            "instructions": SYSTEM_PROMPT,
        }
        sys.update(self.ds_context)
        if self.current_plan:
            sys["active_plan"] = self.current_plan
        return json.dumps(sys, indent=2)

    def _sliding_window(self, messages: list[dict]) -> list[dict]:
        """Keep system + user message + last CONTEXT_WINDOW entries."""
        if len(messages) <= 2 + CONTEXT_WINDOW:
            return messages
        return messages[:2] + messages[-(CONTEXT_WINDOW):]

    async def run(self) -> AsyncGenerator[dict, None]:
        self.alog(f"Chat start: {repr(self.message)[:100]}")

        self._total_input_tokens = 0
        self._total_output_tokens = 0
        self._total_tool_calls = 0

        try:
            messages: list[dict] = [
                {"role": "system", "content": self._build_system_message()},
                {"role": "user", "content": self.message},
            ]

            for _round in range(MAX_ROUNDS):
                if self.cancel.is_set():
                    self.alog("Cancelled")
                    yield {"type": "message_done", "content": "Cancelled."}
                    return

                # Refresh system message with latest dataset schema
                messages[0] = {"role": "system", "content": self._build_system_message()}

                # On the final round, nudge the LLM to wrap up with text
                if _round == MAX_ROUNDS - 1:
                    messages.append({
                        "role": "system",
                        "content": (
                            "You have reached your last action. Do NOT call any tools. "
                            "Summarize what you've accomplished so far and what remains, "
                            "then ask the user if they'd like you to continue."
                        ),
                    })

                trimmed = self._sliding_window(messages)

                self.alog.llm_call_start("agent", _round)
                self.alog.round_input(_round, trimmed)
                t0 = time.monotonic()
                stream = await tool_completion_stream(trimmed, TOOLS, model=self.model)

                # Accumulate streamed content and tool call deltas
                full_content = ""
                tool_call_buffers: dict[int, dict] = {}  # index -> {id, name, arguments}
                finish_reason = None
                round_input = 0
                round_output = 0

                async for chunk in stream:
                    if self.cancel.is_set():
                        break

                    # Capture usage from final chunk (stream_options include_usage)
                    if getattr(chunk, "usage", None):
                        round_input = getattr(chunk.usage, "prompt_tokens", 0)
                        round_output = getattr(chunk.usage, "completion_tokens", 0)
                        self._total_input_tokens += round_input
                        self._total_output_tokens += round_output

                    delta = chunk.choices[0].delta if chunk.choices else None
                    if not delta:
                        continue
                    if chunk.choices[0].finish_reason:
                        finish_reason = chunk.choices[0].finish_reason

                    # Stream content tokens
                    if delta.content:
                        full_content += delta.content
                        yield {"type": "message_delta", "content": delta.content}

                    # Buffer tool call deltas
                    if delta.tool_calls:
                        for tc_delta in delta.tool_calls:
                            idx = tc_delta.index
                            if idx not in tool_call_buffers:
                                tool_call_buffers[idx] = {"id": "", "name": "", "arguments": ""}
                            buf = tool_call_buffers[idx]
                            if tc_delta.id:
                                buf["id"] = tc_delta.id
                            if tc_delta.function:
                                if tc_delta.function.name:
                                    buf["name"] = tc_delta.function.name
                                if tc_delta.function.arguments:
                                    buf["arguments"] += tc_delta.function.arguments

                dt = time.monotonic() - t0
                self.alog.llm_call_end("agent", dt, _round)

                # Charge credits based on actual token usage for this round
                if self.charge_tokens and (round_input + round_output) > 0:
                    if not self.charge_tokens(_round, round_input, round_output):
                        self.alog(f"Token budget exhausted at round {_round}")
                        yield {"type": "error", "code": "quota_exceeded",
                               "plan": self.user_plan}
                        return

                # Emit message_done with accumulated text
                if full_content:
                    yield {"type": "message_done", "content": full_content}
                    self.final_response = full_content

                # Build the assistant message dict for conversation history
                msg_dict: dict = {"role": "assistant"}
                if full_content:
                    msg_dict["content"] = full_content

                # Reconstruct tool calls from buffers
                reconstructed_tool_calls = []
                if tool_call_buffers:
                    for idx in sorted(tool_call_buffers):
                        buf = tool_call_buffers[idx]
                        reconstructed_tool_calls.append(type("TC", (), {
                            "id": buf["id"],
                            "function": type("Fn", (), {
                                "name": buf["name"],
                                "arguments": buf["arguments"],
                            })(),
                        })())
                    msg_dict["tool_calls"] = [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in reconstructed_tool_calls
                    ]
                messages.append(msg_dict)

                # Log output
                self.alog.round_output(_round, full_content)

                # If no tool calls, we're done
                if finish_reason != "tool_calls" or not reconstructed_tool_calls:
                    return

                # Execute each tool call
                self._total_tool_calls += len(reconstructed_tool_calls)
                for tc in reconstructed_tool_calls:
                    tool_name = tc.function.name
                    try:
                        tool_args = json.loads(tc.function.arguments)
                    except json.JSONDecodeError:
                        tool_args = {}

                    self.alog.tool_call(tool_name, tool_args)

                    if tool_name == "execute_r":
                        code = tool_args.get("code", "")
                        description = tool_args.get("description", "")

                        # Send R code to frontend
                        execution_id = str(uuid.uuid4())
                        queue: asyncio.Queue = asyncio.Queue()
                        self.result_queues[execution_id] = queue

                        self.alog.r_code_sent(execution_id, code, description)
                        yield {
                            "type": "r_code",
                            "execution_id": execution_id,
                            "code": code,
                            "description": description,
                        }

                        # Wait for frontend result
                        try:
                            result = await asyncio.wait_for(queue.get(), timeout=120.0)
                        except asyncio.TimeoutError:
                            result = {"success": False, "error": "R execution timed out"}
                        finally:
                            self.result_queues.pop(execution_id, None)

                        self.alog.r_result_received(execution_id, result)

                        success = result.get("success", False)
                        stdout = result.get("stdout", "")
                        error = result.get("error", "")

                        if success:
                            result_text = stdout[:1000] if stdout else "Executed successfully."
                        else:
                            if error.startswith("Error: "):
                                error = error[7:]
                            stderr = result.get("stderr", "")[:500]
                            result_text = f"Error: {error[:1000]}"
                            if stderr and stderr.strip() != error.strip():
                                result_text += f"\nStderr: {stderr}"

                        # Update dataset schema if frontend sent it
                        updated_context = result.get("updated_context")
                        if updated_context:
                            self.update_context(updated_context)

                        yield {
                            "type": "r_code_result",
                            "execution_id": execution_id,
                            "success": success,
                            "summary": result_text[:500],
                        }

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": result_text,
                        })

                    elif tool_name == "plan":
                        raw_steps = tool_args.get("steps", [])
                        # Normalize: accept list of strings or list of {description}
                        steps = [
                            s if isinstance(s, str) else s.get("description", "")
                            for s in raw_steps
                        ]
                        self.current_plan = steps
                        self.alog.plan(steps, False)

                        yield {"type": "plan", "steps": steps}

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": "Plan updated.",
                        })

                    elif tool_name == "ask_user":
                        question = tool_args.get("question", "")
                        ask_id = str(uuid.uuid4())
                        answer_queue: asyncio.Queue = asyncio.Queue()
                        self.result_queues[ask_id] = answer_queue

                        self.alog.ask_user_sent(ask_id, question)
                        yield {
                            "type": "ask_user",
                            "ask_id": ask_id,
                            "question": question,
                        }

                        # Wait for user answer
                        try:
                            answer_result = await asyncio.wait_for(answer_queue.get(), timeout=300.0)
                        except asyncio.TimeoutError:
                            answer_result = {"answer": ""}
                        finally:
                            self.result_queues.pop(ask_id, None)

                        answer = answer_result.get("answer", "")
                        self.alog.user_answered(ask_id, answer)

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": f"User answered: {answer}" if answer else "User did not respond.",
                        })

                    else:
                        # Unknown tool
                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": f"Error: unknown tool '{tool_name}'.",
                        })

        finally:
            self.cleanup()

    def update_context(self, updated_context: dict):
        """Update dataset schema from fresh frontend state."""
        if "active_dataset" in updated_context:
            self.ds_context["active_dataset"] = updated_context["active_dataset"]
        if "other_datasets" in updated_context:
            self.ds_context["other_datasets"] = updated_context["other_datasets"]

    def submit_result(self, execution_id: str, result: dict):
        """Called by the POST /chat/result and /chat/answer endpoints."""
        queue = self.result_queues.get(execution_id)
        if queue:
            queue.put_nowait(result)

    def cleanup(self):
        """Call in finally block: remove cancel event, flush logs, log usage."""
        if self._cleaned_up:
            return
        self._cleaned_up = True
        if self.user_id:
            _cancel_events.pop(self.user_id, None)
        self.alog.flush()
        self._log_usage()

    def _log_usage(self):
        """Insert LLM usage row into Supabase."""
        try:
            client = _get_supabase_admin()
            client.table("llm_usage").insert({
                "user_id": self.user_id,
                "session_id": self.session_id,
                "model": self.model,
                "input_tokens": getattr(self, "_total_input_tokens", 0),
                "output_tokens": getattr(self, "_total_output_tokens", 0),
                "tool_calls": getattr(self, "_total_tool_calls", 0),
                "credits_charged": self.credits_tracker[0],
            }).execute()
        except Exception as e:
            self.alog(f"Failed to log LLM usage: {e}")
