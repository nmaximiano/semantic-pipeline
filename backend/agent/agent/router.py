"""Triage router -- classifies user messages as 'simple' or 'complex'."""
from __future__ import annotations
import time

from agent.llm import chat_completion
from agent.config import REPLAN_MODEL
from agent.logger import log


TRIAGE_PROMPT = """\
Classify the user's message into exactly one category.
Output ONLY the single word "simple" or "complex".

SIMPLE -- read-only viewing OR trivial single-step mutations:
- Questions about data or how to do something
- Viewing / inspecting data (sample rows, column stats, distributions)
- Standalone conversational messages (greetings, thanks) with NO prior complex context
- Asking "what would happen if..." or "how would I..." (explanation, not action)
- Renaming a column
- Deleting / dropping columns
- Duplicating / copying a column
- Sorting the dataset

COMPLEX -- any request that transforms, derives, or restructures data beyond the above:
- Filtering rows (removes data)
- Find and replace values
- Any derived column (formula, rolling window, shift, case-when, format)
- Joining / merging datasets
- Multi-step instructions ("rename X, Y, Z then merge with...")
- Creating multiple dependent columns in sequence
- Follow-ups or confirmations ("yes", "go ahead", "continue", "do it") when
  the conversation history shows a complex operation was being discussed

IMPORTANT: Use the conversation history below to judge follow-up messages.
If a short message like "continue" or "sounds good" follows a complex operation,
classify it as COMPLEX -- the user is continuing a complex workflow, not making
a standalone conversational remark.

{context}
Output ONLY "simple" or "complex"."""


async def classify(
    message: str,
    dataset_context: dict | None = None,
    history: list | None = None,
) -> str:
    ctx_parts: list[str] = []

    if dataset_context:
        ctx_parts.append(
            f"Active dataset: {dataset_context.get('filename', '?')} "
            f"(columns: {dataset_context.get('columns', [])})"
        )

    # Include last 2 turns for follow-up context
    if history:
        for turn in history[-2:]:
            user_msg = turn.get("user", "")
            assistant_msg = turn.get("assistant", "")
            if user_msg:
                ctx_parts.append(f"Previous user message: {user_msg[:200]}")
            if assistant_msg:
                ctx_parts.append(f"Previous assistant response: {assistant_msg[:200]}")

    context = "\n".join(ctx_parts) if ctx_parts else "No dataset context."
    prompt = TRIAGE_PROMPT.format(context=context)

    log(f"Classify LLM call start: message={message[:80]!r}")
    t0 = time.monotonic()
    result = await chat_completion(
        [
            {"role": "system", "content": prompt},
            {"role": "user", "content": message},
        ],
        model=REPLAN_MODEL,
    )
    dt = time.monotonic() - t0

    classification = "complex" if "complex" in result.lower() else "simple"
    log(f"Classify LLM call done: {dt:.2f}s -> {classification}")
    return classification
