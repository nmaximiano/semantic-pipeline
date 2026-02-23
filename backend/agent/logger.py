"""Agent logger. JSON-formatted, newest entries at top of agent.log."""

from __future__ import annotations
import json
import os
import time
from datetime import datetime

_LOG_PATH = os.path.join(os.path.dirname(__file__), "..", "agent.log")


def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]


def _prepend(line: str):
    """Insert a line at the top of the log file."""
    try:
        existing = ""
        if os.path.exists(_LOG_PATH):
            with open(_LOG_PATH) as f:
                existing = f.read()
        with open(_LOG_PATH, "w") as f:
            f.write(line + "\n" + existing)
    except Exception:
        pass


def _entry(event: str, data: dict | None = None):
    """Write a JSON log entry prepended to the file."""
    obj: dict = {"time": _ts(), "event": event}
    if data:
        obj.update(data)
    _prepend(json.dumps(obj))


def log(msg: str):
    """Write a simple log entry."""
    _entry("log", {"message": msg})


class AgentLogger:
    """Per-session logger. JSON entries prepended to agent.log."""

    def __init__(self):
        self._start = time.monotonic()

    def __call__(self, msg: str):
        log(msg)

    def elapsed(self) -> float:
        return time.monotonic() - self._start

    def round_input(self, round_num: int, messages: list):
        msgs = []
        for m in messages:
            role = type(m).__name__
            content = m.content if isinstance(m.content, str) else str(m.content)
            entry: dict = {"role": role, "content": content[:2000]}
            if hasattr(m, "tool_calls") and m.tool_calls:
                entry["tool_calls"] = [
                    {"name": tc["name"], "args": tc["args"]}
                    for tc in m.tool_calls
                ]
            msgs.append(entry)
        _entry("llm_input", {"round": round_num, "message_count": len(messages), "messages": msgs})

    def round_output(self, round_num: int, response):
        data: dict = {
            "round": round_num,
            "content": (response.content or "")[:2000],
        }
        if response.tool_calls:
            data["tool_calls"] = [
                {"name": tc["name"], "args": tc["args"]}
                for tc in response.tool_calls
            ]
        _entry("llm_output", data)

    def tool_result(self, tool_name: str, result: str):
        _entry("tool_result", {"tool": tool_name, "result": result[:2000]})

    def plan(self, steps: list, complete: bool):
        _entry("plan", {"complete": complete, "steps": steps})

    def replan(self, step_id: int, tool_name: str, steps: list, complete: bool):
        _entry("replan", {"after_step": step_id, "tool": tool_name, "complete": complete, "steps": steps})

    def flush(self):
        total = time.monotonic() - self._start
        _entry("session_end", {"total_seconds": round(total, 2)})
