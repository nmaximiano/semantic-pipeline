from __future__ import annotations
import json
import re as _re
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
        id=1, description="Answer the user's question",
        tool=None, expected_args={}, considerations="",
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

CRITICAL — QUESTIONS vs ACTIONS (you MUST follow this):
- If the user is ASKING a question (how, what, why, can I, would it, could I, \
what would happen, is it possible, etc.), plan ONLY a single tool=null step \
that ANSWERS the question in plain text. Do NOT plan mutations or tool calls.
- "What would I have to do to merge these two datasets?" → ONE tool=null \
step that explains the merge process. Do NOT plan renames, inspections, or joins.
- "How many columns does this have?" → ONE tool=null step answering from \
the dataset context already provided to you. Or use a read-only tool if needed.
- "Can I filter by date?" → ONE tool=null step explaining yes/no and how.
- Only plan mutations when the user gives a clear, DIRECT COMMAND to DO \
something: "Merge these datasets on Date", "Delete the Notes column", etc.
- If the request is AMBIGUOUS and you truly cannot proceed, plan a single \
ask_user_tool step as the FIRST step to get clarification before acting. \
But be autonomous — only ask when the ambiguity would lead to meaningfully \
different outcomes. Minor uncertainties should be resolved with your best judgment.

CRITICAL RULES (you MUST follow these):
- BEFORE any join/merge: rename all overlapping non-key columns so each \
name clearly identifies its source dataset (e.g. "Volume" → "BTC_Volume", \
"Volume" → "SPX_Volume"). Use rename_column_tool for each rename. \
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
- Each step: {{"description": "...", "tool": "tool_name_or_null", \
"expected_args": {{}}, "considerations": "...", "status": "pending"}}
- One tool per step. Maximum {max_steps} steps.
- The LAST step MUST be tool=null. This step provides the user a concise \
text summary of what was done (e.g. "Created btc_pct_change and \
spx_pct_change columns. The spx_close column had commas removed to \
enable numeric calculation."). Do NOT use a tool call for the final step. \
This is the ONLY response the user will see, so it must be self-contained.
"""

REPLAN_PROMPT = """\
You are a plan evaluator for Semantic Pipeline. You are given the original \
plan, the action that was just taken, and its result.

Your job: produce an UPDATED plan that reflects what happened. Think about:
- Did the action succeed or fail?
- Is the step that was just attempted now done, or does it need a different approach?
- Are the remaining steps still correct given what we learned?
- Should any steps be added, removed, or reordered?
- Is the overall task now COMPLETE?

The task is COMPLETE when: all meaningful work is done and only the final \
summary/answer step remains or has been done. Set "complete": true.

Output ONLY JSON: {{"complete": true/false, "steps": [...]}}
Each step: {{"description": "...", "tool": "tool_name_or_null", \
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

        "If the step has a tool, call that tool with the right arguments. "
        "If the step has tool=null, respond with a complete text answer "
        "referencing actual data from previous tool results. This is the "
        "user's final response — make it self-contained and useful.",

        "If the user's original message was a question, your job is to "
        "ANSWER it — not to perform the action they asked about. "
        "Read-only tool calls to gather information for an answer are fine.",

        "If a step fails and there are multiple valid recovery paths, or "
        "if something is fundamentally ambiguous, use ask_user_tool to pause "
        "and get the user's input. Do NOT write a question in text and then "
        "continue working — ask_user_tool is the ONLY way to actually stop "
        "and wait for the user. But be autonomous: only ask when you truly "
        "cannot proceed without user input.",

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
        "NEVER treat a question as a command. 'How do I merge these?' "
        "means 'explain how' — NOT 'do it for me'.",
        "NEVER end with a tool call. The final step must always be a "
        "plain-text summary describing what was accomplished.",
        "BEFORE any join/merge: you MUST rename all overlapping non-key "
        "columns so each name clearly identifies its source dataset "
        "(e.g. 'Volume' -> 'BTC_Volume', 'Volume' -> 'SPX_Volume'). "
        "Use rename_column_tool for each. Never skip this.",
        "BEFORE any positional operation (rolling_window, shift_column, "
        "column_formula referencing row order): the dataset MUST be sorted "
        "correctly. Time-series data must be ascending (oldest first) by "
        "date/time. Use sort_dataset_tool to sort before proceeding.",
    ],
}


# ── ComplexAgent ─────────────────────────────────────────────────────

@tool
def ask_user_tool(question: str) -> str:
    """Ask the user a question and STOP execution until they respond.
    Only use this when you truly cannot proceed without user input:
    - A critical step failed and there are multiple valid recovery paths
    - The request is fundamentally ambiguous (e.g. which column to use
      when several could apply)
    Do NOT use this for minor uncertainties you can resolve yourself.
    Do NOT use this to confirm before every step — be autonomous.

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

            self.alog("Planning...")
            plan_resp = await self.llm.ainvoke([
                SystemMessage(content=json.dumps(plan_prompt, indent=2)),
                HumanMessage(content=self.message),
            ])
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
                response = await self.tool_llm.ainvoke(msgs_for_llm)
                self.alog.round_output(_round, response)
                action_messages.append(response)

                # Reasoning text
                if response.content:
                    yield {"type": "message", "content": response.content}
                    self.final_response = response.content
                    self._message_parts.append(response.content)

                # Text-only step (tool=null)
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

                # ── ask_user_tool → stop the loop ──
                if any(tc["name"] == "ask_user_tool" for tc in response.tool_calls):
                    self.alog("ask_user_tool called, pausing for user input")
                    break

                # ── REPLAN after tool execution ──
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

        replan_prompt: dict = {"role": "planner", "instructions": REPLAN_PROMPT}
        replan_prompt.update(self.ds_context)

        resp = await self.llm.ainvoke([
            SystemMessage(content=json.dumps(replan_prompt, indent=2)),
            HumanMessage(content=json.dumps(replan_input, indent=2)),
        ])

        new_steps, complete = _parse_plan_response(resp.content or "")
        return new_steps, complete
