"""Persistent rolling chat memory for agent conversations.

Stores conversation turns as structured dicts per session in the
sessions.history JSONB column. History survives server restarts.

When the serialized size exceeds MAX_CHARS the oldest entries are dropped.
"""

from __future__ import annotations
import json


MAX_CHARS = 12_000  # ~3-4k tokens worth of context


def _get_admin():
    from services import supabase_admin
    return supabase_admin


def get_history(session_id: str) -> list[dict]:
    """Return conversation history as a list of turn dicts."""
    if not session_id:
        return []
    try:
        result = (
            _get_admin()
            .table("sessions")
            .select("history")
            .eq("id", session_id)
            .maybe_single()
            .execute()
        )
        if result.data and result.data.get("history"):
            return result.data["history"]
    except Exception:
        pass
    return []


def append_turn(session_id: str,
                user_message: str, assistant_response: str,
                tools_used: list[str] | None = None,
                pending_question: str | None = None):
    """Append one conversation turn, trimming from the front if over limit."""
    if not session_id:
        return

    entry: dict = {"user": user_message, "assistant": assistant_response}
    if tools_used:
        entry["tools"] = tools_used
    if pending_question:
        entry["pending_question"] = pending_question

    history = get_history(session_id)
    history.append(entry)

    # Trim from the front until total size is under the limit
    while _total_chars(history) > MAX_CHARS and len(history) > 1:
        history.pop(0)

    try:
        _get_admin().table("sessions").update({
            "history": history,
            "updated_at": "now()",
        }).eq("id", session_id).execute()
    except Exception:
        pass


def clear(session_id: str):
    """Clear conversation history for a session."""
    if not session_id:
        return
    try:
        (_get_admin()
         .table("sessions")
         .update({"history": [], "updated_at": "now()"})
         .eq("id", session_id)
         .execute())
    except Exception:
        pass


def _total_chars(entries: list[dict]) -> int:
    return sum(len(json.dumps(e)) for e in entries)
