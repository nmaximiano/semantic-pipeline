"""
Agent logger.

Two outputs:
  1. agent.log          — compact summary log (append, chronological)
  2. conversations/     — one .jsonl file per chat request with full trace
"""
from __future__ import annotations
import json
import os
import time
import uuid
from datetime import datetime

_BASE_DIR = os.path.join(os.path.dirname(__file__), "..")
_LOG_PATH = os.path.join(_BASE_DIR, "agent.log")
_CONV_DIR = os.path.join(_BASE_DIR, "conversations")

os.makedirs(_CONV_DIR, exist_ok=True)


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


def _full_ts() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]


def _append(path: str, line: str):
    try:
        with open(path, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def _prepend(path: str, line: str):
    """Insert a line at the top of a file."""
    try:
        existing = ""
        if os.path.exists(path):
            with open(path) as f:
                existing = f.read()
        with open(path, "w") as f:
            f.write(line + "\n" + existing)
    except Exception:
        pass


def _summary_entry(event: str, data: dict | None = None):
    """Write a JSON log entry prepended to agent.log (newest first)."""
    obj: dict = {"time": _ts(), "event": event}
    if data:
        obj.update(data)
    _prepend(_LOG_PATH, json.dumps(obj, ensure_ascii=False))


def log(msg: str):
    """Write a simple log entry to agent.log."""
    _summary_entry("log", {"message": msg})


class AgentLogger:
    """Per-conversation logger.

    Writes a detailed trace file in conversations/ and a compact
    summary line to agent.log.  Every event is recorded chronologically
    so you can read the file top-to-bottom to understand exactly what
    happened during a single chat request.
    """

    def __init__(self):
        self._start = time.monotonic()
        self._conv_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]
        self._trace_path = os.path.join(_CONV_DIR, f"{self._conv_id}.jsonl")

    # -- internal helpers --------------------------------------------------

    def _trace(self, event: str, data: dict | None = None):
        """Append one JSON line to the conversation trace file."""
        obj: dict = {"time": _full_ts(), "event": event}
        if data:
            obj.update(data)
        _append(self._trace_path, json.dumps(obj, ensure_ascii=False))

    # -- public API (unchanged signatures) ---------------------------------

    def __call__(self, msg: str):
        """Short log message → both summary + trace."""
        log(msg)
        self._trace("log", {"message": msg})

    def elapsed(self) -> float:
        return time.monotonic() - self._start

    @property
    def conv_id(self) -> str:
        return self._conv_id

    # -- conversation lifecycle --------------------------------------------

    def session_start(self, *,
                      user_message: str,
                      agent_type: str,
                      session_id: str,
                      dataset_context: dict | None = None,
                      other_dataframes: list | None = None,
                      history: list | None = None):
        """Record the full request context at the start of a conversation."""
        data = {
            "conv_id": self._conv_id,
            "agent_type": agent_type,
            "session_id": session_id,
            "user_message": user_message,
        }
        if dataset_context:
            data["dataset_context"] = dataset_context
        if other_dataframes:
            data["other_dataframes"] = other_dataframes
        if history:
            # Store full history in trace, but cap individual entries at 4K
            data["history"] = [
                {k: (v[:4000] if isinstance(v, str) else v) for k, v in turn.items()}
                for turn in history
            ] if isinstance(history, list) else history
        self._trace("session_start", data)
        _summary_entry("session_start", {
            "conv_id": self._conv_id,
            "agent_type": agent_type,
            "user_message": user_message[:200],
        })

    # -- LLM calls ---------------------------------------------------------

    def llm_call_start(self, phase: str, round_num: int | None = None):
        data: dict = {"phase": phase}
        if round_num is not None:
            data["round"] = round_num
        self._trace("llm_call_start", data)

    def llm_call_end(self, phase: str, duration: float,
                     round_num: int | None = None):
        data: dict = {"phase": phase, "duration_s": round(duration, 2)}
        if round_num is not None:
            data["round"] = round_num
        self._trace("llm_call_end", data)

    def round_input(self, round_num: int, messages: list):
        """Full LLM input messages for a round."""
        msgs = []
        for m in messages:
            if isinstance(m, dict):
                msgs.append({
                    "role": m.get("role", "unknown"),
                    "content": m.get("content", ""),
                })
            else:
                role = type(m).__name__
                content = m.content if isinstance(m.content, str) else str(m.content)
                msgs.append({"role": role, "content": content})
        self._trace("llm_input", {
            "round": round_num,
            "message_count": len(messages),
            "messages": msgs,
        })

    def round_output(self, round_num: int, content: str):
        """Full LLM output for a round."""
        self._trace("llm_output", {
            "round": round_num,
            "content": content or "",
            "content_length": len(content or ""),
            "empty": not bool(content),
        })
        _summary_entry("llm_output", {
            "round": round_num,
            "content": (content or "")[:500],
            "empty": not bool(content),
        })

    # -- SSE events sent to frontend --------------------------------------

    def sse_event(self, event: dict):
        """Record every SSE event yielded to the client."""
        # For the trace, store the full event
        self._trace("sse_out", {"payload": event})

    # -- R code execution --------------------------------------------------

    def r_code_sent(self, execution_id: str, code: str, description: str):
        self._trace("r_code_sent", {
            "execution_id": execution_id,
            "code": code,
            "description": description,
        })

    def r_result_received(self, execution_id: str, result: dict):
        self._trace("r_result_received", {
            "execution_id": execution_id,
            "success": result.get("success"),
            "stdout": result.get("stdout", ""),
            "stderr": result.get("stderr", ""),
            "error": result.get("error", ""),
        })

    # -- Ask user ----------------------------------------------------------

    def ask_user_sent(self, ask_id: str, question: str):
        self._trace("ask_user", {"ask_id": ask_id, "question": question})

    def user_answered(self, ask_id: str, answer: str):
        self._trace("user_answer", {"ask_id": ask_id, "answer": answer})

    # -- Plan events -------------------------------------------------------

    def plan(self, steps: list, complete: bool):
        self._trace("plan", {"complete": complete, "steps": steps})
        _summary_entry("plan", {
            "complete": complete,
            "step_count": len(steps),
        })

    def tool_call(self, tool_name: str, tool_args: dict):
        self._trace("tool_call", {"tool": tool_name, "args": tool_args})
        _summary_entry("tool_call", {"tool": tool_name})

    # -- Errors ------------------------------------------------------------

    def error(self, error_type: str, detail: str):
        self._trace("error", {"error_type": error_type, "detail": detail})
        _summary_entry("error", {"error_type": error_type, "detail": detail[:300]})

    # -- Legacy compatibility (still used by some call sites) ---------------

    def tool_result(self, tool_name: str, result: str):
        self._trace("tool_result", {"tool": tool_name, "result": result})

    # -- Session end -------------------------------------------------------

    def flush(self):
        total = time.monotonic() - self._start
        self._trace("session_end", {
            "total_seconds": round(total, 2),
            "conv_id": self._conv_id,
        })
        _summary_entry("session_end", {
            "conv_id": self._conv_id,
            "total_seconds": round(total, 2),
        })
