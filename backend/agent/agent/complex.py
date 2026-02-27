from __future__ import annotations
import json
import re
import time
from typing import AsyncGenerator, TypedDict

from agent.llm import chat_completion, plan_completion, replan_completion
from agent.agent.base import BaseAgent


MAX_PLAN_STEPS = 10


class PlanStep(TypedDict):
    id: int
    description: str
    r_code: str
    considerations: str
    status: str  # "pending" | "done" | "skipped"


# -- Plan helpers ---------------------------------------------------------

def _parse_plan_response(raw_text: str) -> tuple[list[PlanStep], bool]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
            except json.JSONDecodeError:
                return [_fallback_step()], False
        else:
            match = re.search(r"\[.*\]", text, re.DOTALL)
            if match:
                try:
                    data = {"steps": json.loads(match.group()), "complete": False}
                except json.JSONDecodeError:
                    return [_fallback_step()], False
            else:
                return [_fallback_step()], False

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
            r_code=item.get("r_code", ""),
            considerations=item.get("considerations", ""),
            status=item.get("status", "pending"),
        ))
    return (steps or [_fallback_step()]), complete


def _fallback_step() -> PlanStep:
    return PlanStep(
        id=1, description="Ask user to clarify their request",
        r_code="",
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


def _extract_r_blocks(text: str) -> list[str]:
    return re.findall(r"```r\s*\n(.*?)```", text, re.DOTALL)


# -- Prompts --------------------------------------------------------------

R_CAPABILITIES = """\
Available R packages: base R, dplyr, tidyr, stringr, lubridate, ggplot2.
The active dataset's variable name is given in the "active_dataset" context. \
Use this EXACT variable name in your R code and when talking to the user. \
Assign results back to the same variable.
Other datasets in the R environment are listed under "other_datasets" in the context — \
reference them by their variable name directly.
To RENAME a variable: `new_name <- old_name; rm(old_name)`.
If a variable name is long or awkward, feel free to rename it first.
Use tidyverse style (dplyr pipes) when appropriate.
For diagnostic/inspection code (counting rows, str(), head()), \
wrap it in `local({ ... })` so temporary variables do NOT leak into the user's \
environment. Only create top-level variables for data the user actually wants to keep.
NEVER wrap mutations/transformations of the active dataset in local({ ... }). \
Assignments like `df <- df %>% select(...)` must happen at the TOP LEVEL so \
they persist in the global environment. local() is ONLY for read-only inspection.
If a join produces 0 rows, check key formats with str() — mismatched types \
(e.g. character vs Date) are a common cause.
Before doing arithmetic on a column, verify it is numeric. Columns imported \
from CSV often have commas or percent signs (e.g. "6,941.81", "-0.33%") making \
them character type. Use as.numeric(gsub("[^0-9.eE-]", "", col)) to clean first.
If execution returns an error, do NOT tell the user it succeeded. Report \
the error and attempt to fix it.

CLEANUP: Remove temporary standalone objects (helper vectors, lookup tables, \
subsetted data used mid-calculation) with rm() at the end of the code block. \
KEEP all columns added to the dataset as part of the user's request — these \
are the result of their work and may be needed in follow-up questions. Only \
remove intermediate columns that were solely used to compute a final column \
(e.g. a temp column you mutate twice — drop the intermediate, keep the final). \
For read-only multi-step analyses, wrap in local({ ... }) so temporaries \
never enter the global environment.

CRITICAL — ```r blocks are AUTO-EXECUTED:
Any code inside a ```r block is IMMEDIATELY executed in the user's live R \
environment with NO preview or confirmation. To show illustrative code \
examples, use ```text blocks or inline `code` — NEVER ```r.
If your response offers to do something or asks whether the user wants you \
to proceed ("Would you like me to...", "I can help you...", "Let me know \
which..."), STOP there. Do NOT include any ```r code blocks in that same \
response. Wait for the user to confirm before writing code.
When using markdown tables, use at most 2 columns. The chat panel is narrow \
so wider tables become unreadable. For multi-field comparisons use bullet \
lists or key: value lines instead."""

PLANNING_PROMPT = """\
You are a planning assistant. Create a step-by-step plan for the user's request.
Each step describes an R code operation to perform on the data.

{r_capabilities}

WHAT TO PLAN:
- Each step should describe a single R operation.
- If the user is asking a QUESTION and you can answer from context alone, \
return {{"complete": true, "steps": []}}.
- If the user is asking a question that requires R to compute, plan the R steps.
- Only plan data mutations when the user gives a clear, direct command.
- If the user explicitly says NOT to take action ("don't do it yet", \
"just explain", "how would you..."), return {{"complete": true, "steps": []}} \
and let the text response handle it.

CRITICAL RULES:
- CHECK conversation_history FIRST. If previous turns already performed \
the same operations (type conversions, sorting, column creation), do NOT \
redo them. Build on what already exists in the dataset.
- BEFORE any join/merge: rename overlapping non-key columns so names are \
clear (e.g. "Volume" -> "BTC_Volume"). Do renames in one step.
- AFTER any join/merge: check nrow() of the result. If it's 0 or \
drastically different from expected, investigate key types with str() and \
report the issue.
- BEFORE any positional operation (rolling window, lag, cumsum): ensure data \
is sorted correctly. Time-series must be ascending by date.
- If standalone temporary objects (helper vectors, lookup tables) were \
created during the plan, add a cleanup step to rm() them. Do NOT remove \
columns added to the dataset — those are the user's work product.
- NEVER delete source dataframes after a merge/join — the user may still \
need the originals. If unsure whether to keep or remove, ask with \
[ASK_USER: ...].
- Maximum {max_steps} steps.

OUTPUT FORMAT:
- Output ONLY JSON: {{"complete": false, "steps": [...]}}
- Each step: {{"description": "...", "r_code": "suggested R code", \
"considerations": "...", "status": "pending"}}
"""

EXECUTE_PROMPT = """\
You are a data assistant executing a pre-defined plan step by step.
You are given the current step to execute. Write the R code for it.

{r_capabilities}

RULES:
- Write R code in a ```r block.
- Use the active dataset's real variable name (from context). Assign results back to it.
- Before your code, briefly explain what you're about to do.
- If the step suggests R code, refine it as needed based on the actual \
dataset context (column names, types).
- If a previous step failed or the result shows an error, adapt your approach.
- Do NOT retry the same code if it fails -- try a different approach.
- If the execution result contains "Error:", the step FAILED. Do not claim success.
- When using markdown, never use h1 (#) or h2 (##). Use h3 (###) max.
- If you need to ask the user a question before proceeding (e.g. to clarify \
which join key to use, or to confirm a destructive operation), write ONLY: \
[ASK_USER: your question here] \
Do NOT write any R code in the same response as an [ASK_USER] block.
"""

REPLAN_PROMPT = """\
You are a plan evaluator. Given a plan, the action just taken, and its result, \
update the plan.

{r_capabilities}

INSTRUCTIONS:
1. Mark the executed step as "done" (or "skipped" if it failed and is \
no longer needed).
2. Check if remaining steps are still correct given the result.
3. If a step failed, adjust it or add an alternative.
4. If ALL work for the user's original request is done, set "complete": true.

RULES:
- Do NOT add verification steps. Trust the R execution results.
- Keep the plan concise. Maximum {max_steps} steps total.
- NEVER drop the user's core action from the plan.

Output ONLY JSON: {{"complete": true/false, "steps": [...]}}
Each step: {{"description": "...", "r_code": "...", "considerations": "...", \
"status": "pending|done|skipped"}}
"""

SUMMARY_PROMPT = """\
All planned actions are now complete. Here is what the user originally asked:

\"{user_message}\"

Based on the full conversation above (including all R code executions and \
their results), write a response to the user. If they asked a question, \
answer it. If they requested an action, summarize what was done. Be brief \
(2-3 sentences), friendly, and reference specific results (column names, \
row counts, etc.). Do NOT write any R code.
"""


# -- ComplexAgent ---------------------------------------------------------

class ComplexAgent(BaseAgent):
    MAX_ROUNDS = 15
    BUDGET_CHECK_INTERVAL = 5  # re-charge credits every N rounds

    async def run(self) -> AsyncGenerator[dict, None]:
        self.alog(f"Chat start: {repr(self.message)[:100]}")

        plan_steps: list[PlanStep] = []
        plan_complete = False

        try:
            # ---------- PLAN ----------
            if self.cancel.is_set():
                yield {"type": "message", "content": "Cancelled."}
                return

            planning_sys = PLANNING_PROMPT.format(
                r_capabilities=R_CAPABILITIES, max_steps=MAX_PLAN_STEPS,
            )
            plan_prompt: dict = {"role": "planner", "instructions": planning_sys}
            plan_prompt.update(self.ds_context)

            plan_messages = [
                {"role": "system", "content": json.dumps(plan_prompt, indent=2)},
                {"role": "user", "content": self.message},
            ]

            self.alog.llm_call_start("plan")
            self.alog.round_input(0, plan_messages)
            t0 = time.monotonic()
            plan_text = await plan_completion(plan_messages)
            dt = time.monotonic() - t0
            self.alog.llm_call_end("plan", dt)
            self.alog.round_output(0, plan_text)

            plan_steps, plan_complete = _parse_plan_response(plan_text)
            self.alog.plan(_serialize_plan(plan_steps), plan_complete)

            yield {"type": "plan", "steps": _serialize_plan(plan_steps)}

            # ---------- LOOP ----------
            action_sys = {
                "role": "executor",
                "instructions": EXECUTE_PROMPT.format(
                    r_capabilities=R_CAPABILITIES
                ),
            }
            action_sys.update(self.ds_context)

            action_messages = [
                {"role": "system", "content": json.dumps(action_sys, indent=2)},
                {"role": "user", "content": self.message},
            ]

            if plan_complete or not plan_steps:
                plan_complete = True

            for _round in range(self.MAX_ROUNDS):
                if self.cancel.is_set():
                    self.alog("Cancelled")
                    yield {"type": "message", "content": "Cancelled."}
                    return

                # Re-charge credits every N rounds
                if (_round > 0
                        and _round % self.BUDGET_CHECK_INTERVAL == 0
                        and self.check_budget):
                    if not self.check_budget():
                        self.alog(f"Budget exhausted at round {_round}")
                        yield {"type": "error", "code": "quota_exceeded",
                               "plan": self.user_plan}
                        return

                if plan_complete:
                    self.alog(f"Plan complete at round {_round}")
                    break

                next_step = _next_pending(plan_steps)
                if next_step is None:
                    self.alog("No pending steps, marking complete")
                    plan_complete = True
                    break

                # -- ACT --
                plan_ctx = {
                    "plan": _serialize_plan(plan_steps),
                    "current_step": {
                        "id": next_step["id"],
                        "description": next_step["description"],
                        "r_code": next_step["r_code"],
                        "considerations": next_step["considerations"],
                    },
                }
                ephemeral = f"[EXECUTE NEXT STEP]\n{json.dumps(plan_ctx, indent=2)}"

                msgs_for_llm = action_messages + [
                    {"role": "user", "content": ephemeral}
                ]
                self.alog.llm_call_start("execute", _round)
                self.alog.round_input(_round, msgs_for_llm)
                t0 = time.monotonic()
                content = await chat_completion(msgs_for_llm)
                dt = time.monotonic() - t0
                self.alog.llm_call_end("execute", dt, _round)
                self.alog.round_output(_round, content)

                action_messages.append({"role": "assistant", "content": content})

                # Extract R code and text
                r_blocks = _extract_r_blocks(content)
                text_only = re.sub(
                    r"```r\s*\n.*?```", "", content, flags=re.DOTALL
                ).strip()

                # Check for ask_user markers
                ask_match = re.search(
                    r'\[ASK_USER:\s*(.*?)\]', content, re.DOTALL
                )
                if ask_match:
                    question = ask_match.group(1).strip()
                    self.alog.ask_user_sent("pending", question)
                    ask_id = None
                    async for event in self.ask_user(question):
                        ask_id = event["ask_id"]
                        self.alog.ask_user_sent(ask_id, question)
                        yield event
                    answer = ""
                    if ask_id:
                        answer = await self.await_user_answer(ask_id)
                        self.alog.user_answered(ask_id, answer)
                        action_messages.append({
                            "role": "user",
                            "content": f"[USER ANSWER] {answer}",
                        })
                    plan_steps, plan_complete = await self._replan(
                        plan_steps, next_step,
                        "Asked user a question",
                        f"Question: {question}\nAnswer: {answer}",
                    )
                    yield {
                        "type": "plan_update",
                        "steps": _serialize_plan(plan_steps),
                    }
                    continue

                if text_only:
                    yield {"type": "message", "content": text_only}
                    self.final_response = text_only
                    self._message_parts.append(text_only)

                if not r_blocks:
                    # Text-only step -- replan
                    plan_steps, plan_complete = await self._replan(
                        plan_steps, next_step,
                        "Text response (no R code)", content,
                    )
                    yield {
                        "type": "plan_update",
                        "steps": _serialize_plan(plan_steps),
                    }
                    continue

                # Execute R code blocks
                action_summary = "R code execution"
                result_summary = ""

                for code in r_blocks:
                    code = code.strip()
                    if not code:
                        continue

                    execution_id = None
                    async for event in self.execute_r_code(
                        code, next_step["description"]
                    ):
                        execution_id = event["execution_id"]
                        self.alog.r_code_sent(execution_id, code, next_step["description"])
                        yield event

                    if execution_id:
                        result = await self.await_r_result(execution_id)
                        self.alog.r_result_received(execution_id, result)
                        success = result.get("success", False)
                        stdout = result.get("stdout", "")
                        error = result.get("error", "")

                        if success:
                            result_summary = (
                                stdout[:500] if stdout
                                else "Executed successfully."
                            )
                        else:
                            result_summary = f"Error: {error}"

                        yield {
                            "type": "r_code_result",
                            "execution_id": execution_id,
                            "success": success,
                            "summary": result_summary,
                        }

                        # Add result to conversation for context
                        action_messages.append({
                            "role": "user",
                            "content": (
                                f"[R EXECUTION RESULT]\n"
                                f"Success: {success}\n{result_summary}"
                            ),
                        })

                # -- REPLAN --
                executed_code = "\n".join(r_blocks)
                plan_steps, plan_complete = await self._replan(
                    plan_steps, next_step, action_summary, result_summary,
                    executed_code=executed_code,
                )
                self.alog.replan(
                    next_step["id"], action_summary,
                    _serialize_plan(plan_steps), plan_complete,
                )
                yield {
                    "type": "plan_update",
                    "steps": _serialize_plan(plan_steps),
                }

            # ---------- SUMMARIZE ----------
            summary_messages = action_messages + [{
                "role": "user",
                "content": SUMMARY_PROMPT.format(
                    user_message=self.message
                ),
            }]
            self.alog.llm_call_start("summary")
            self.alog.round_input(0, summary_messages)
            t0 = time.monotonic()
            summary = await chat_completion(summary_messages)
            dt = time.monotonic() - t0
            self.alog.llm_call_end("summary", dt)
            self.alog.round_output(0, summary)

            if summary:
                yield {"type": "message", "content": summary}
                self.final_response = summary
                self._message_parts.append(summary)

        finally:
            self.cleanup()

    async def _replan(
        self,
        current_plan: list[PlanStep],
        executed_step: PlanStep,
        action_name: str,
        action_result: str,
        executed_code: str = "",
    ) -> tuple[list[PlanStep], bool]:
        replan_input = {
            "current_plan": _serialize_plan(current_plan),
            "step_just_executed": {
                "id": executed_step["id"],
                "description": executed_step["description"],
            },
            "action": action_name,
            "result": action_result[:2000],
        }
        if executed_code:
            replan_input["executed_code"] = executed_code[:1000]

        replan_sys = REPLAN_PROMPT.format(
            r_capabilities=R_CAPABILITIES, max_steps=MAX_PLAN_STEPS
        )
        replan_prompt: dict = {"role": "planner", "instructions": replan_sys}
        replan_prompt.update(self.ds_context)

        replan_messages = [
            {"role": "system", "content": json.dumps(replan_prompt, indent=2)},
            {"role": "user", "content": json.dumps(replan_input, indent=2)},
        ]

        self.alog.llm_call_start("replan")
        self.alog.round_input(0, replan_messages)
        t0 = time.monotonic()
        resp = await replan_completion(replan_messages)
        dt = time.monotonic() - t0
        self.alog.llm_call_end("replan", dt)
        self.alog.round_output(0, resp)

        new_steps, complete = _parse_plan_response(resp)
        return new_steps, complete
