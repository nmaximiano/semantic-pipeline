"""Triage router — classifies user messages as 'simple' or 'complex'."""
from __future__ import annotations
import time

from langchain_core.messages import SystemMessage, HumanMessage
from agent.llm import get_llm
from agent.logger import log


TRIAGE_PROMPT = """\
Classify the user's message into exactly one category.
Output ONLY the single word "simple" or "complex".

SIMPLE — read-only viewing OR trivial single-step mutations:
- Questions about data or how to do something
- Viewing / inspecting data (sample rows, column stats, distributions)
- Standalone conversational messages (greetings, thanks) with NO prior complex context
- Asking "what would happen if..." or "how would I..." (explanation, not action)
- Renaming a column
- Deleting / dropping columns
- Duplicating / copying a column
- Sorting the dataset

COMPLEX — any request that transforms, derives, or restructures data beyond the above:
- Filtering rows (removes data)
- Find and replace values
- Any derived column (formula, rolling window, shift, case-when, format)
- Joining / merging datasets
- LLM-powered transformations (classify, extract, translate, summarize text)
- Creating multiple dependent columns in sequence
- Multi-step instructions ("rename X, Y, Z then merge with...")
- Follow-ups or confirmations ("yes", "go ahead", "continue", "do it") when
  the conversation history shows a complex operation was being discussed

IMPORTANT: Use the conversation history below to judge follow-up messages.
If a short message like "continue" or "sounds good" follows a complex operation,
classify it as COMPLEX — the user is continuing a complex workflow, not making
a standalone conversational remark.

{context}
Output ONLY "simple" or "complex"."""


async def classify(
    message: str,
    dataset_info: dict | None = None,
    open_datasets: list[dict] | None = None,
    session_id: str | None = None,
) -> str:
    """Classify a user message as 'simple' or 'complex'.

    Considers dataset context and recent conversation history so that
    follow-ups like "go ahead" after discussing a merge route correctly.
    """
    ctx_parts: list[str] = []

    if dataset_info:
        ctx_parts.append(
            f"Active dataset: {dataset_info.get('filename', '?')} "
            f"(columns: {dataset_info.get('columns', [])})"
        )
    if open_datasets:
        names = [d.get("filename", "?") for d in open_datasets]
        ctx_parts.append(f"Open datasets in session: {', '.join(names)}")

    # Include last 2 turns so follow-ups ("yes, do it") get proper context
    if session_id:
        from agent.memory import get_history
        history = get_history(session_id)
        if history:
            for turn in history[-2:]:
                user_msg = turn.get("user", "")
                assistant_msg = turn.get("assistant", "")
                tools = turn.get("tools", [])
                if user_msg:
                    ctx_parts.append(f"Previous user message: {user_msg[:200]}")
                if tools:
                    ctx_parts.append(f"Tools used: {', '.join(tools)}")
                if assistant_msg:
                    ctx_parts.append(f"Previous assistant response: {assistant_msg[:200]}")

    context = "\n".join(ctx_parts) if ctx_parts else "No dataset context."
    prompt = TRIAGE_PROMPT.format(context=context)

    llm = get_llm()
    log(f"Classify LLM call start: message={message[:80]!r}")
    t0 = time.monotonic()
    resp = await llm.ainvoke([
        SystemMessage(content=prompt),
        HumanMessage(content=message),
    ])
    dt = time.monotonic() - t0

    result = (resp.content or "").strip().lower()
    classification = "complex" if "complex" in result else "simple"
    log(f"Classify LLM call done: {dt:.2f}s → {classification}")
    if "complex" in result:
        return "complex"
    return "simple"
