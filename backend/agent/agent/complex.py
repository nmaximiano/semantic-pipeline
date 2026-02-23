from __future__ import annotations
import json
import re as _re
import time
from typing import AsyncGenerator, TypedDict

from langchain_core.messages import SystemMessage, HumanMessage
from langchain_core.tools import tool

from agent.agent.base import BaseAgent, _tool_descriptions


MAX_PLAN_STEPS = 10


class PlanStep(TypedDict):
    id: int
    description: str
    tool: str | None
    expected_args: dict
    considerations: str
    status: str  # "pending" | "done" | "skipped"


# ── Plan helpers ────────────────────────────────────────────────────

def _parse_plan_response(raw_text: str) -> tuple[list[PlanStep], bool]:
    """Parse planner output → (steps, complete).

    Expects JSON: {"complete": bool, "steps": [...]}
    Falls back gracefully on parse errors.
    """
    text = raw_text.strip()
    if text.startswith("```"):
        text = _re.sub(r"^```(?:json)?\s*", "", text)
        text = _re.sub(r"\s*```$", "", text)

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = _re.search(r"\{.*\}", text, _re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
            except json.JSONDecodeError:
                return [_fallback_step()], False
        else:
            # Try bare array
            match = _re.search(r"\[.*\]", text, _re.DOTALL)
            if match:
                try:
                    data = {"steps": json.loads(match.group()), "complete": False}
                except json.JSONDecodeError:
                    return [_fallback_step()], False
            else:
                return [_fallback_step()], False

    # Handle both {"complete": ..., "steps": [...]} and bare [...]
    if isinstance(data, list):
        data = {"steps": data, "complete": False}

    complete = bool(data.get("complete", False))
    raw_steps = data.get("steps", [])
    if not isinstance(raw_steps, list):
        return [_fallback_step()], complete

    steps: list[PlanStep] = []
    for i, item in enumerate(raw_steps[:MAX_PLAN_STEPS]):
        steps.append(PlanStep(
            id=i + 1,
            description=item.get("description", f"Step {i + 1}"),
            tool=item.get("tool") or None,
            expected_args=item.get("expected_args", {}),
            considerations=item.get("considerations", ""),
            status=item.get("status", "pending"),
        ))
    return (steps or [_fallback_step()]), complete


def _fallback_step() -> PlanStep:
    return PlanStep(
        id=1, description="Ask user to clarify their request",
        tool="ask_user_tool",
        expected_args={"question": "Could you clarify what you'd like me to do?"},
        considerations="Plan could not be parsed",
        status="pending",
    )


def _serialize_plan(steps: list[PlanStep]) -> list[dict]:
    return [
        {"id": s["id"], "description": s["description"], "status": s["status"]}
        for s in steps
    ]


def _next_pending(steps: list[PlanStep]) -> PlanStep | None:
    for s in steps:
        if s["status"] == "pending":
            return s
    return None



# ── Prompts ──────────────────────────────────────────────────────────

PLANNING_PROMPT = """\
You are a planning assistant for Semantic Pipeline. Create a step-by-step \
execution plan for the user's request.

Available tools (do NOT call them — just reference by name):

{tool_catalog}

WHAT TO PLAN:
- The plan is STRICTLY for tool actions. Every step must have a tool.
- Do NOT include summary, answer, or explanation steps. A separate \
summarization step runs automatically after your plan completes.
- If the user is asking a QUESTION (how, what, why, can I, etc.) and \
you can answer from context alone with NO tools needed, return \
{{"complete": true, "steps": []}}.
- If the user is asking a question that requires read-only tools to \
gather information (e.g. sample_rows, column_stats), plan ONLY those \
read-only tool steps. Do NOT plan mutations.
- Only plan mutations when the user gives a clear, DIRECT COMMAND to DO \
something: "Merge these datasets on Date", "Delete the Notes column", etc.
- If the user's intent is genuinely unclear and choosing wrong would produce \
meaningfully different outcomes, plan a single ask_user_tool step to clarify. \
But be highly autonomous — only ask when you truly cannot make a reasonable \
assumption. Never ask about error recovery or tool choices — just act.

CRITICAL RULES (you MUST follow these):
- BEFORE any join/merge: rename all overlapping non-key columns so each \
name clearly identifies its source dataset (e.g. "Volume" → "BTC_Volume", \
"Volume" → "SPX_Volume"). Use rename_columns_tool (plural) to rename \
multiple columns in ONE step — do NOT plan separate rename steps for each column. \
Do NOT skip this step — the automatic _2 suffix produces unclear names.
- Only use sample_rows / column_stats when you genuinely need information \
that is NOT already in the dataset context (column names, row count, and \
avg chars are already provided). Do NOT plan inspection steps just to \
"verify" or "show" data — the user can see the table in the UI.
- NEVER plan a sample_rows step at the end to "display results". The user \
sees the table update automatically.
- BEFORE any positional operation (rolling_window, shift_column, or \
column_formula that references row order): plan a sort step FIRST. \
Time-series data MUST be sorted ascending (oldest first) by the date/time \
column before computing moving averages, lags, percent changes, etc. \
Use sort_dataset_tool to sort. If sort order is unknown, plan a sample_rows \
step to check before sorting.

OUTPUT FORMAT:
- Output ONLY JSON: {{"complete": false, "steps": [...]}}
- Each step: {{"description": "...", "tool": "tool_name", \
"expected_args": {{}}, "considerations": "...", "status": "pending"}}
- One tool per step. Maximum {max_steps} steps. Every step MUST have a tool.
"""

REPLAN_PROMPT = """\
You are a plan evaluator for Semantic Pipeline. You are given a plan, the \
action just taken, and its result. Your ONLY job is to update the plan.

Available tools (ONLY use these — do not invent tools):

{tool_catalog}

INSTRUCTIONS:
1. Mark the step that was just executed as "done" (or "skipped" if it failed \
and is no longer needed).
2. Check if remaining steps are still correct given the result.
3. If a step failed, adjust it or add an alternative — but do NOT add \
unnecessary steps.
4. If ALL tool work for the user's original request is done, set \
"complete": true.

RULES:
- The plan is STRICTLY for tool actions. Do NOT add summary, answer, or \
explanation steps — summarization happens automatically after the plan.
- Every step must reference a tool from the list above.
- Do NOT add verification or inspection steps (sample_rows, distribution, \
column_stats) to check whether a prior step worked. Trust the tool results.
- Do NOT add sort steps before join/merge — joins match on key values, not \
row order. Only add sort before positional ops (rolling_window, shift_column).
- Use rename_columns_tool (plural, with a dict) to batch multiple renames \
into ONE step. Do NOT split renames into separate steps.
- NEVER drop the user's core action (e.g. the join step) from the plan. \
Prep steps exist to support the core action — if you run out of step budget, \
drop prep steps, not the core action.
- Keep the plan concise. Maximum {max_steps} steps total (including done steps).

Output ONLY JSON: {{"complete": true/false, "steps": [...]}}
Each step: {{"description": "...", "tool": "tool_name", \
"expected_args": {{}}, "considerations": "...", "status": "pending|done|skipped"}}
Keep done/skipped steps in the list (for history) but update their status.
"""

EXECUTE_PROMPT = {
    "role": (
        "You are a data assistant for Semantic Pipeline executing "
        "a pre-defined plan step by step."
    ),
    "instructions": [
        "You are given a plan and told which step to execute next.",

        "Every step has a tool. Call that tool with the right arguments.",

        "If a tool fails, adapt autonomously: try a different tool or "
        "approach. Do NOT ask the user for help with error recovery. "
        "Only use ask_user_tool when the user's intent is genuinely unclear "
        "and you cannot make a reasonable assumption (e.g. multiple valid "
        "join columns and no way to guess which one). Never ask for "
        "permission or confirmation — just act.",

        "Do NOT call sample_rows or column_stats to 'show' or 'display' "
        "data to the user — they can already see the table in the UI. "
        "Only use read-only tools when YOU need information to complete "
        "a task. The dataset context already gives you column names, row "
        "count, and avg chars — do not re-fetch what you already know.",

        "Before calling a tool, briefly explain what you're about to do.",

        "Do NOT retry the same tool with identical arguments if it fails.",

        "Apply one filter condition at a time when using filter_rows_tool.",

        "When using markdown, never use h1 (#) or h2 (##). Use h3 (###) max.",

        "Every tool accepts an optional `dataset` parameter (filename or ID). "
        "If omitted, it operates on the active dataset.",
    ],
    "critical_rules": [
        "BEFORE any join/merge: you MUST rename all overlapping non-key "
        "columns so each name clearly identifies its source dataset "
        "(e.g. 'Volume' -> 'BTC_Volume', 'Volume' -> 'SPX_Volume'). "
        "Use rename_columns_tool (plural) to batch all renames for a "
        "dataset into one call. Never skip this.",
        "BEFORE any positional operation (rolling_window, shift_column, "
        "column_formula referencing row order): the dataset MUST be sorted "
        "correctly. Time-series data must be ascending (oldest first) by "
        "date/time. Use sort_dataset_tool to sort before proceeding.",
    ],
}

SUMMARY_PROMPT = """\
All planned actions are now complete. Here is what the user originally asked:

\"{user_message}\"

Based on the full conversation above (including all tool calls and their \
results), write a response to the user. If they asked a question, answer it. \
If they requested an action, summarize what was done. Be brief (2-3 sentences), \
friendly, and reference specific results (column names, row counts, etc.). \
Do NOT call any tools.
"""


# ── ComplexAgent ─────────────────────────────────────────────────────

@tool
def ask_user_tool(question: str) -> str:
    """Ask the user a clarifying question and STOP execution until they respond.

    ONLY use this when you genuinely do not know what the user wants:
    - The request is fundamentally ambiguous (e.g. "merge these" but multiple
      possible join columns exist and choosing wrong would produce bad data)
    - The user's intent is unclear and you cannot make a reasonable assumption

    NEVER use this for:
    - Tool failures or errors — just adapt and try a different approach
    - Asking permission to proceed — be autonomous, just do it
    - Confirming your approach — use your best judgment and act
    - Anything where there is an obvious next step

    Parameters:
      question: the question to ask the user"""
    return question


class ComplexAgent(BaseAgent):
    MAX_ROUNDS = 15

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Add ask_user_tool (complex agent only)
        self.data_tools.append(ask_user_tool)
        self.tool_map[ask_user_tool.name] = ask_user_tool
        self.tool_llm = self.llm.bind_tools(self.data_tools)

    async def run(self) -> AsyncGenerator[dict, None]:
        """Plan-then-act chat. Yields SSE event dicts.

        Flow:
            1. PLAN    — LLM creates structured plan (no tools bound)
            2. LOOP    — while plan not complete:
                           a. ACT    — LLM executes next pending step
                           b. REPLAN — LLM rewrites plan based on results
            3. CONCLUDE — final LLM call to write answer with full context
        """
        self.alog(f"Chat start: {repr(self.message)[:100]}")

        plan_steps: list[PlanStep] = []
        plan_complete = False

        try:
            # ────────────── PLAN ──────────────
            if self.cancel.is_set():
                yield {"type": "message", "content": "Cancelled."}
                return

            tool_catalog = _tool_descriptions(self.data_tools)
            planning_sys = PLANNING_PROMPT.format(
                tool_catalog=tool_catalog, max_steps=MAX_PLAN_STEPS,
            )
            plan_prompt: dict = {"role": "planner", "instructions": planning_sys}
            plan_prompt.update(self.ds_context)

            self.alog("LLM call start (plan)")
            t0 = time.monotonic()
            plan_resp = await self.llm.ainvoke([
                SystemMessage(content=json.dumps(plan_prompt, indent=2)),
                HumanMessage(content=self.message),
            ])
            dt = time.monotonic() - t0
            self.alog(f"LLM call done (plan): {dt:.2f}s")
            plan_steps, plan_complete = _parse_plan_response(plan_resp.content or "")
            self.alog.plan(_serialize_plan(plan_steps), plan_complete)

            yield {"type": "plan", "steps": _serialize_plan(plan_steps)}

            # ────────────── LOOP ──────────────
            action_prompt: dict = {**EXECUTE_PROMPT}
            action_prompt.update(self.ds_context)

            # Accumulates full conversation (system + user + AI + tool results)
            action_messages = [
                SystemMessage(content=json.dumps(action_prompt, indent=2)),
                HumanMessage(content=self.message),
            ]

            # Empty plan (pure question answerable from context) — skip to summary
            if plan_complete or not plan_steps:
                plan_complete = True

            for _round in range(self.MAX_ROUNDS):
                if self.cancel.is_set():
                    self.alog("Cancelled")
                    yield {"type": "message", "content": "Cancelled."}
                    return

                if plan_complete:
                    self.alog(f"Plan complete at round {_round}")
                    break

                next_step = _next_pending(plan_steps)
                if next_step is None:
                    self.alog("No pending steps, marking complete")
                    plan_complete = True
                    break

                # ── ACT ──
                plan_ctx = {
                    "plan": _serialize_plan(plan_steps),
                    "current_step": {
                        "id": next_step["id"],
                        "description": next_step["description"],
                        "tool": next_step["tool"],
                        "expected_args": next_step["expected_args"],
                        "considerations": next_step["considerations"],
                    },
                }
                ephemeral = HumanMessage(
                    content=f"[EXECUTE NEXT STEP]\n{json.dumps(plan_ctx, indent=2)}"
                )

                msgs_for_llm = action_messages + [ephemeral]
                self.alog.round_input(_round, msgs_for_llm)
                self.alog(f"LLM call start (execute round {_round})")
                t0 = time.monotonic()
                response = await self.tool_llm.ainvoke(msgs_for_llm)
                dt = time.monotonic() - t0
                self.alog(f"LLM call done (execute round {_round}): {dt:.2f}s")
                self.alog.round_output(_round, response)
                action_messages.append(response)

                # Reasoning text
                if response.content:
                    yield {"type": "message", "content": response.content}
                    self.final_response = response.content
                    self._message_parts.append(response.content)

                # Text-only step (tool=null) — replan to assess progress
                if not response.tool_calls:
                    plan_steps, plan_complete = await self._replan(
                        plan_steps, next_step,
                        "Text response (no tool call)", response.content or "",
                    )
                    self.alog.replan(
                        next_step["id"], "none",
                        _serialize_plan(plan_steps), plan_complete,
                    )
                    yield {"type": "plan_update", "steps": _serialize_plan(plan_steps)}
                    continue

                # Execute tool calls
                async for event in self.execute_tool_calls(response):
                    yield event

                # Append tool messages to conversation
                action_messages.extend(self._pending_tool_messages)

                # ── ask_user_tool → stop, no summary ──
                if any(tc["name"] == "ask_user_tool" for tc in response.tool_calls):
                    question = next(
                        tc["args"].get("question", "")
                        for tc in response.tool_calls
                        if tc["name"] == "ask_user_tool"
                    )
                    self._pending_question = question
                    self.alog("ask_user_tool called, pausing for user input")
                    return

                # ── REPLAN ──
                n_calls = len(response.tool_calls)
                if n_calls == 1:
                    action_summary = response.tool_calls[0]["name"]
                    result_summary = self._pending_tool_messages[-1].content
                else:
                    names = [tc["name"] for tc in response.tool_calls]
                    action_summary = ", ".join(names)
                    parts = []
                    for tc, tm in zip(response.tool_calls, self._pending_tool_messages):
                        args_brief = ", ".join(
                            f"{k}={v!r}" for k, v in tc["args"].items()
                            if k != "dataset"
                        )
                        parts.append(f"[{tc['name']}({args_brief})]: {tm.content}")
                    result_summary = "\n".join(parts)

                plan_steps, plan_complete = await self._replan(
                    plan_steps, next_step, action_summary, result_summary,
                )
                self.alog.replan(
                    next_step["id"], action_summary,
                    _serialize_plan(plan_steps), plan_complete,
                )
                yield {"type": "plan_update", "steps": _serialize_plan(plan_steps)}

            # ────────────── SUMMARIZE ──────────────
            # Always produce a final response: summarize actions taken
            # and/or answer the user's original question.
            self.alog("LLM call start (summary)")
            t0 = time.monotonic()
            summary_resp = await self.llm.ainvoke(
                action_messages + [
                    HumanMessage(
                        content=SUMMARY_PROMPT.format(
                            user_message=self.message,
                        )
                    ),
                ]
            )
            dt = time.monotonic() - t0
            self.alog(f"LLM call done (summary): {dt:.2f}s")
            if summary_resp.content:
                yield {"type": "message", "content": summary_resp.content}
                self.final_response = summary_resp.content
                self._message_parts.append(summary_resp.content)

        finally:
            self.cleanup()

    async def _replan(
        self,
        current_plan: list[PlanStep],
        executed_step: PlanStep,
        action_name: str,
        action_result: str,
    ) -> tuple[list[PlanStep], bool]:
        """LLM call to rewrite the plan after an action. Returns (new_steps, complete)."""
        replan_input = {
            "current_plan": _serialize_plan(current_plan),
            "step_just_executed": {
                "id": executed_step["id"],
                "description": executed_step["description"],
            },
            "action": action_name,
            "result": action_result[:2000],  # truncate large results
        }

        tool_catalog = _tool_descriptions(self.data_tools)
        replan_sys = REPLAN_PROMPT.format(tool_catalog=tool_catalog, max_steps=MAX_PLAN_STEPS)
        replan_prompt: dict = {"role": "planner", "instructions": replan_sys}
        replan_prompt.update(self.ds_context)

        self.alog("LLM call start (replan)")
        t0 = time.monotonic()
        resp = await self.replan_llm.ainvoke([
            SystemMessage(content=json.dumps(replan_prompt, indent=2)),
            HumanMessage(content=json.dumps(replan_input, indent=2)),
        ])
        dt = time.monotonic() - t0
        self.alog(f"LLM call done (replan): {dt:.2f}s")

        new_steps, complete = _parse_plan_response(resp.content or "")
        return new_steps, complete

    async def run_resume(self, prior_question: str) -> AsyncGenerator[dict, None]:
        """Resume execution after ask_user_tool paused a previous turn.

        Skips router and planner. Builds a fresh plan from the user's reply
        in the context of the prior question, then executes normally.
        """
        self.alog(f"Chat resume: prior_question={prior_question[:80]!r}, "
                  f"reply={self.message[:80]!r}")

        try:
            # Build a plan that incorporates the user's answer
            tool_catalog = _tool_descriptions(self.data_tools)
            planning_sys = PLANNING_PROMPT.format(
                tool_catalog=tool_catalog, max_steps=MAX_PLAN_STEPS,
            )
            plan_prompt: dict = {"role": "planner", "instructions": planning_sys}
            plan_prompt.update(self.ds_context)

            resume_msg = (
                f"I previously asked: \"{prior_question}\"\n"
                f"The user replied: \"{self.message}\"\n\n"
                "Based on this answer, create a plan to complete the original task."
            )

            self.alog("LLM call start (plan-resume)")
            t0 = time.monotonic()
            plan_resp = await self.llm.ainvoke([
                SystemMessage(content=json.dumps(plan_prompt, indent=2)),
                HumanMessage(content=resume_msg),
            ])
            dt = time.monotonic() - t0
            self.alog(f"LLM call done (plan-resume): {dt:.2f}s")
            plan_steps, plan_complete = _parse_plan_response(plan_resp.content or "")
            self.alog.plan(_serialize_plan(plan_steps), plan_complete)

            yield {"type": "plan", "steps": _serialize_plan(plan_steps)}

            # ── Execute loop (same as run) ──
            action_prompt: dict = {**EXECUTE_PROMPT}
            action_prompt.update(self.ds_context)

            action_messages = [
                SystemMessage(content=json.dumps(action_prompt, indent=2)),
                HumanMessage(content=resume_msg),
            ]

            if plan_complete or not plan_steps:
                plan_complete = True

            for _round in range(self.MAX_ROUNDS):
                if self.cancel.is_set():
                    self.alog("Cancelled")
                    yield {"type": "message", "content": "Cancelled."}
                    return

                if plan_complete:
                    self.alog(f"Plan complete at round {_round}")
                    break

                next_step = _next_pending(plan_steps)
                if next_step is None:
                    self.alog("No pending steps, marking complete")
                    plan_complete = True
                    break

                plan_ctx = {
                    "plan": _serialize_plan(plan_steps),
                    "current_step": {
                        "id": next_step["id"],
                        "description": next_step["description"],
                        "tool": next_step["tool"],
                        "expected_args": next_step["expected_args"],
                        "considerations": next_step["considerations"],
                    },
                }
                ephemeral = HumanMessage(
                    content=f"[EXECUTE NEXT STEP]\n{json.dumps(plan_ctx, indent=2)}"
                )

                msgs_for_llm = action_messages + [ephemeral]
                self.alog.round_input(_round, msgs_for_llm)
                self.alog(f"LLM call start (execute round {_round})")
                t0 = time.monotonic()
                response = await self.tool_llm.ainvoke(msgs_for_llm)
                dt = time.monotonic() - t0
                self.alog(f"LLM call done (execute round {_round}): {dt:.2f}s")
                self.alog.round_output(_round, response)
                action_messages.append(response)

                if response.content:
                    yield {"type": "message", "content": response.content}
                    self.final_response = response.content
                    self._message_parts.append(response.content)

                if not response.tool_calls:
                    plan_steps, plan_complete = await self._replan(
                        plan_steps, next_step,
                        "Text response (no tool call)", response.content or "",
                    )
                    self.alog.replan(
                        next_step["id"], "none",
                        _serialize_plan(plan_steps), plan_complete,
                    )
                    yield {"type": "plan_update", "steps": _serialize_plan(plan_steps)}
                    continue

                async for event in self.execute_tool_calls(response):
                    yield event

                action_messages.extend(self._pending_tool_messages)

                if any(tc["name"] == "ask_user_tool" for tc in response.tool_calls):
                    question = next(
                        tc["args"].get("question", "")
                        for tc in response.tool_calls
                        if tc["name"] == "ask_user_tool"
                    )
                    self._pending_question = question
                    self.alog("ask_user_tool called, pausing for user input")
                    return

                n_calls = len(response.tool_calls)
                if n_calls == 1:
                    action_summary = response.tool_calls[0]["name"]
                    result_summary = self._pending_tool_messages[-1].content
                else:
                    names = [tc["name"] for tc in response.tool_calls]
                    action_summary = ", ".join(names)
                    parts = []
                    for tc, tm in zip(response.tool_calls, self._pending_tool_messages):
                        args_brief = ", ".join(
                            f"{k}={v!r}" for k, v in tc["args"].items()
                            if k != "dataset"
                        )
                        parts.append(f"[{tc['name']}({args_brief})]: {tm.content}")
                    result_summary = "\n".join(parts)

                plan_steps, plan_complete = await self._replan(
                    plan_steps, next_step, action_summary, result_summary,
                )
                self.alog.replan(
                    next_step["id"], action_summary,
                    _serialize_plan(plan_steps), plan_complete,
                )
                yield {"type": "plan_update", "steps": _serialize_plan(plan_steps)}

            # ── SUMMARIZE ──
            self.alog("LLM call start (summary)")
            t0 = time.monotonic()
            summary_resp = await self.llm.ainvoke(
                action_messages + [
                    HumanMessage(
                        content=SUMMARY_PROMPT.format(
                            user_message=resume_msg,
                        )
                    ),
                ]
            )
            dt = time.monotonic() - t0
            self.alog(f"LLM call done (summary): {dt:.2f}s")
            if summary_resp.content:
                yield {"type": "message", "content": summary_resp.content}
                self.final_response = summary_resp.content
                self._message_parts.append(summary_resp.content)

        finally:
            self.cleanup()
