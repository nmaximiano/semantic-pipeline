"""Simple agent logger. Newest sessions at top of agent.log."""

from __future__ import annotations
import os
from datetime import datetime

_LOG_PATH = os.path.join(os.path.dirname(__file__), "..", "agent.log")


class AgentLogger:
    """Buffer log lines during a chat session, flush to file when done."""

    def __init__(self):
        self._buf: list[str] = []

    def _ts(self) -> str:
        return datetime.now().strftime("%H:%M:%S")

    def __call__(self, msg: str):
        self._buf.append(f"[{self._ts()}]: {msg}")

    def round_input(self, round_num: int, messages: list):
        self(f"Round {round_num} input ({len(messages)} messages)")
        for i, m in enumerate(messages):
            role = type(m).__name__
            content = m.content if isinstance(m.content, str) else str(m.content)
            # Full content for system prompt (round 0, msg 0), truncated for rest
            limit = 2000 if i == 0 and round_num == 0 else 300
            self(f"  [{i}] {role}: {content[:limit]}")
            if hasattr(m, "tool_calls") and m.tool_calls:
                self(f"  [{i}] tool_calls: {m.tool_calls}")

    def round_output(self, round_num: int, response):
        self(f"Round {round_num} output")
        content_preview = (response.content or "")[:200]
        self(f"  content: {repr(content_preview)}")
        if response.tool_calls:
            for tc in response.tool_calls:
                self(f"  tool_call: {tc['name']}({tc['args']})")
        else:
            self(f"  tool_calls: none")

    def tool_result(self, tool_name: str, result: str):
        preview = result[:300]
        self(f"  tool_result [{tool_name}]: {preview}")

    def plan(self, steps: list, complete: bool):
        self(f"Plan: {len(steps)} steps, complete={complete}")
        for s in steps:
            self(f"  step {s['id']}: [{s['status']}] {s['description']}")

    def replan(self, step_id: int, tool_name: str, steps: list, complete: bool):
        self(f"Replan after step {step_id} (tool={tool_name}): {len(steps)} steps, complete={complete}")
        for s in steps:
            self(f"  step {s['id']}: [{s['status']}] {s['description']}")

    def flush(self):
        if not self._buf:
            return
        block = "\n".join(self._buf) + "\n\n"
        try:
            existing = ""
            if os.path.exists(_LOG_PATH):
                with open(_LOG_PATH) as f:
                    existing = f.read()
            with open(_LOG_PATH, "w") as f:
                f.write(block + existing)
        except Exception:
            pass
        self._buf.clear()
