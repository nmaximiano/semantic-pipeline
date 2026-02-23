from __future__ import annotations
import json
import time
from typing import AsyncGenerator

from langchain_core.messages import SystemMessage, HumanMessage
from agent.agent.base import BaseAgent


class SimpleAgent(BaseAgent):
    MAX_ROUNDS = 6
    SYSTEM_PROMPT = {
        "role": "You are a data assistant for Semantic Pipeline.",
        "instructions": [
            "Answer questions directly and concisely. Use tools ONLY when "
            "the user explicitly asks you to DO something or when you need "
            "to look up data to answer their question.",

            "QUESTIONS vs ACTIONS — this is critical:\n"
            "- If the user is ASKING a question (how, what, why, can I, "
            "would, could, is it possible, what would happen, etc.), "
            "ANSWER the question with words. Do NOT perform mutations.\n"
            "- 'What would I have to do to merge these two datasets?' → "
            "Explain the steps. Do NOT start renaming or merging.\n"
            "- 'How many rows have missing values?' → Use a read-only tool "
            "to look it up, then answer. Read-only lookups are fine.\n"
            "- 'Can I filter by date?' → Answer yes/no and explain how. "
            "Do NOT apply a filter.\n"
            "- Only perform mutations when the user gives a clear, direct "
            "command: 'Rename Volume to BTC_Volume', 'Filter rows where "
            "price > 100', 'Delete the Notes column'.",

            "WHEN IN DOUBT, ASK:\n"
            "If the user's intent is unclear or could be interpreted "
            "multiple ways, ask a clarifying question before acting. "
            "Examples:\n"
            "- 'Clean up the dates' → Ask: which column and what format?\n"
            "- 'Fix the data' → Ask: what specifically needs fixing?\n"
            "- 'Add a moving average' → Ask: which column and what window "
            "size?\n"
            "It is always better to ask than to guess wrong.",

            "TOOL USAGE RULES:\n"
            "- Do NOT call sample_rows or column_stats to 'show' the user "
            "data — they can already see the table in the UI.\n"
            "- Only use read-only tools when YOU genuinely need the "
            "information to complete a task (e.g. checking exact column "
            "names before writing a formula, or answering a question about "
            "data values).\n"
            "- NEVER end your turn with a tool call. After all tools are "
            "done, always finish with a plain-text summary of what was "
            "accomplished.\n"
            "- The dataset context already tells you the column names, row "
            "count, and avg chars — do not re-fetch what you already know.",

            "Think step by step — explain your reasoning alongside tool calls.",
            "When you have enough information, provide a clear, concise response.",
            "Do NOT retry the same tool with identical arguments if it fails.",
            "Apply one filter condition at a time when using filter_rows_tool.",
            "When using markdown, never use h1 (#) or h2 (##). Use h3 (###) max.",
            "Every tool accepts an optional `dataset` parameter (filename or ID). "
            "If omitted, it operates on the active dataset.",
        ],
        "critical_rules": [
            "NEVER assume a question is a command. 'How do I filter this?' "
            "means 'explain how' — NOT 'do it for me'.",
            "BEFORE any join/merge: you MUST rename all overlapping non-key "
            "columns so each name clearly identifies its source dataset "
            "(e.g. 'Volume' -> 'BTC_Volume'). Use rename_column_tool for each.",
            "BEFORE any positional operation (rolling_window, shift_column, "
            "or column_formula that references row order): verify the dataset "
            "is sorted correctly for the calculation. Time-series data MUST be "
            "sorted ascending (oldest first) by the date/time column. Use "
            "sample_rows to check row order if unsure, then use "
            "sort_dataset_tool to sort before proceeding.",
        ],
    }

    async def run(self) -> AsyncGenerator[dict, None]:
        """Simple free-form tool loop. Yields SSE event dicts."""
        self.alog(f"SimpleAgent start: {repr(self.message)[:100]}")

        try:
            sys_prompt: dict = {**self.SYSTEM_PROMPT}
            sys_prompt.update(self.ds_context)

            messages = [
                SystemMessage(content=json.dumps(sys_prompt, indent=2)),
                HumanMessage(content=self.message),
            ]

            for _round in range(self.MAX_ROUNDS):
                if self.cancel.is_set():
                    self.alog("Cancelled")
                    yield {"type": "message", "content": "Cancelled."}
                    return

                self.alog.round_input(_round, messages)
                self.alog(f"LLM call start (simple round {_round})")
                t0 = time.monotonic()
                response = await self.tool_llm.ainvoke(messages)
                dt = time.monotonic() - t0
                self.alog(f"LLM call done (simple round {_round}): {dt:.2f}s")
                self.alog.round_output(_round, response)
                messages.append(response)

                # Emit text
                if response.content:
                    yield {"type": "message", "content": response.content}
                    self.final_response = response.content
                    self._message_parts.append(response.content)

                # No tool calls → done
                if not response.tool_calls:
                    return

                # Execute tool calls
                async for event in self.execute_tool_calls(response):
                    yield event

                messages.extend(self._pending_tool_messages)

            # Safety net: rounds exhausted without final text
            if not self.final_response:
                yield {
                    "type": "message",
                    "content": "I ran out of steps. Please try a simpler request.",
                }

        finally:
            self.cleanup()
