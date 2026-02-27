from __future__ import annotations
import json
import re
import time
from typing import AsyncGenerator

from agent.llm import chat_completion
from agent.agent.base import BaseAgent


def _extract_r_blocks(text: str) -> list[str]:
    """Extract all ```r ... ``` code blocks from text."""
    return re.findall(r"```r\s*\n(.*?)```", text, re.DOTALL)


R_CAPABILITIES = """\
You have access to an R environment running in the user's browser via WebR.
Available R packages: base R, dplyr, tidyr, stringr, lubridate, ggplot2.

When the user asks you to DO something to the data, write R code in ```r blocks.
The active dataset's variable name is given in the "active_dataset" context \
(the "name" field). Use this EXACT variable name in your R code and when talking \
to the user. After transformations, assign the result back to the same variable.
Other datasets in the R environment are listed under "other_datasets" in the context — \
reference them by their variable name directly.
To RENAME a variable: `new_name <- old_name; rm(old_name)`.
If a variable name is long or awkward, feel free to rename it first.

When the user asks a QUESTION, answer with text. Only write R code if you
need to compute something or if the user explicitly asks for a transformation.

CRITICAL — ```r blocks are AUTO-EXECUTED:
Any code you write inside a ```r block will be IMMEDIATELY and AUTOMATICALLY \
executed in the user's live R environment. There is NO preview or confirmation.
- If the user asks a hypothetical question ("how would you...", "what steps \
would you take...", "explain how to...") or explicitly says NOT to take action \
("don't do it yet", "do not merge", "just explain", "don't make any changes"), \
respond with TEXT ONLY. Do NOT include any ```r blocks.
- To show illustrative code examples in an explanation, use ```text blocks \
or inline `code`. NEVER use ```r for illustrative examples — it WILL execute.
- When in doubt about whether the user wants action or explanation, default \
to explanation only (no ```r blocks). You can always ask to confirm.
- If your response offers to do something or asks whether the user wants you \
to proceed ("Would you like me to...", "I can help you...", "Let me know \
which..."), STOP there. Do NOT include any ```r code blocks in that same \
response. Wait for the user to confirm before writing code.

RULES:
- Use tidyverse style (dplyr pipes) when appropriate
- For joins/merges, use dplyr::left_join, inner_join, etc.
- If a join produces 0 rows, check key formats with str() — mismatched types \
(e.g. character vs Date) are a common cause.
- Before doing arithmetic on a column, verify it is numeric. Columns imported \
from CSV often have commas or percent signs (e.g. "6,941.81", "-0.33%") making \
them character type. Use as.numeric(gsub("[^0-9.eE-]", "", col)) to clean first.
- Always assign results back to the same variable if modifying the dataset
- For read-only inspection, just print the result (it will be captured)
- Do NOT use install.packages() -- packages are pre-installed
- Do NOT use file I/O (read.csv, write.csv) -- data is already loaded
- Keep code concise and correct
- When using markdown, never use h1 (#) or h2 (##). Use h3 (###) max.
- When using markdown tables, use at most 2 columns. The chat panel is narrow \
so wider tables become unreadable. For multi-field comparisons use bullet \
lists or key: value lines instead.
- If execution returns an error, do NOT tell the user it succeeded. Report \
the error and attempt to fix it.

CLEANUP: Remove temporary standalone objects (helper vectors, lookup tables, \
subsetted data used mid-calculation) with rm() at the end of the code block. \
KEEP all columns added to the dataset as part of the user's request — these \
are the result of their work and may be needed in follow-up questions. Only \
remove intermediate columns that were solely used to compute a final column \
(e.g. a temp column you mutate twice — drop the intermediate, keep the final). \
For read-only multi-step analyses, wrap in local({ ... }) so temporaries \
never enter the global environment.

NEVER wrap mutations/transformations of the active dataset in local({ ... }). \
Assignments like `df <- df %>% select(...)` must happen at the TOP LEVEL so \
they persist in the global environment. local() is ONLY for read-only inspection."""


# Safety net: detect user messages that explicitly ask for explanation only
_NO_ACTION_RE = re.compile(
    r"(?i)\b("
    r"don'?t\s+(?:do|yet|actually|make|merge|change|execute|run|apply|modify|touch)"
    r"|do\s+not\s+(?:do|yet|actually|make|merge|change|execute|run|apply|modify|touch)"
    r"|just\s+(?:explain|tell|describe|outline|list|show\s+me\s+how)"
    r"|how\s+would\s+you"
    r"|what\s+(?:steps|approach|would\s+you)"
    r"|without\s+(?:doing|executing|running|making)"
    r"|hypothetically"
    r"|explain\s+(?:how|what|the\s+steps)"
    r")\b"
)


class SimpleAgent(BaseAgent):
    MAX_ROUNDS = 4

    async def run(self) -> AsyncGenerator[dict, None]:
        self.alog(f"SimpleAgent start: {repr(self.message)[:100]}")

        try:
            sys_prompt: dict = {
                "role": "You are a data assistant.",
                "instructions": R_CAPABILITIES,
            }
            sys_prompt.update(self.ds_context)

            messages = [
                {"role": "system", "content": json.dumps(sys_prompt, indent=2)},
                {"role": "user", "content": self.message},
            ]

            for _round in range(self.MAX_ROUNDS):
                if self.cancel.is_set():
                    self.alog("Cancelled")
                    yield {"type": "message", "content": "Cancelled."}
                    return

                self.alog.llm_call_start("simple", _round)
                self.alog.round_input(_round, messages)
                t0 = time.monotonic()
                content = await chat_completion(messages)
                dt = time.monotonic() - t0
                self.alog.llm_call_end("simple", dt, _round)
                self.alog.round_output(_round, content)

                messages.append({"role": "assistant", "content": content})

                # Extract R code blocks
                r_blocks = _extract_r_blocks(content)

                if not r_blocks:
                    # Pure text response
                    yield {"type": "message", "content": content}
                    self.final_response = content
                    self._message_parts.append(content)
                    return

                # Safety net: if user explicitly asked for explanation only,
                # treat the whole response as text (don't execute code blocks)
                if _NO_ACTION_RE.search(self.message):
                    self.alog("Safety net: user asked for explanation — "
                              "suppressing R code execution")
                    yield {"type": "message", "content": content}
                    self.final_response = content
                    self._message_parts.append(content)
                    return

                # Strip R code blocks from the text for the message
                text_only = re.sub(
                    r"```r\s*\n.*?```", "", content, flags=re.DOTALL
                ).strip()
                if text_only:
                    yield {"type": "message", "content": text_only}
                    self._message_parts.append(text_only)

                # Execute each R code block
                had_error = False
                for code in r_blocks:
                    code = code.strip()
                    if not code:
                        continue

                    # Send R code to frontend
                    self.alog.r_code_sent("pending", code, "Executing R code")
                    execution_id = None
                    async for event in self.execute_r_code(code, "Executing R code"):
                        execution_id = event["execution_id"]
                        self.alog.r_code_sent(execution_id, code, "Executing R code")
                        yield event

                    if execution_id:
                        result = await self.await_r_result(execution_id)
                        self.alog.r_result_received(execution_id, result)

                        summary = ""
                        if result.get("success"):
                            stdout = result.get("stdout", "")
                            summary = stdout[:500] if stdout else "Code executed successfully."
                        else:
                            summary = f"Error: {result.get('error', 'Unknown error')}"
                            had_error = True

                        yield {
                            "type": "r_code_result",
                            "execution_id": execution_id,
                            "success": result.get("success", False),
                            "summary": summary,
                        }

                        # If error, add to messages for retry
                        if not result.get("success"):
                            messages.append({
                                "role": "user",
                                "content": (
                                    f"The R code failed with error: {summary}\n"
                                    "Please fix the code and try again."
                                ),
                            })

                if had_error:
                    continue  # retry round

                self.final_response = text_only or content
                return

            if not self.final_response:
                yield {
                    "type": "message",
                    "content": "I ran out of steps. Please try a simpler request.",
                }

        finally:
            self.cleanup()
