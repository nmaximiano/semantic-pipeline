"""Agent logger — thin wrapper around Python logging."""
from __future__ import annotations
import logging
import time
import uuid
from datetime import datetime

_log = logging.getLogger("agent")


class AgentLogger:
    """Per-conversation logger. All output goes to Python logging."""

    def __init__(self):
        self._start = time.monotonic()
        self._conv_id = datetime.now().strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:6]

    def __call__(self, msg: str):
        _log.info("[%s] %s", self._conv_id, msg)

    def elapsed(self) -> float:
        return time.monotonic() - self._start

    @property
    def conv_id(self) -> str:
        return self._conv_id

    def session_start(self, *, user_message: str, agent_type: str,
                      session_id: str, dataset_context: dict | None = None,
                      other_dataframes: list | None = None,
                      history: list | None = None):
        _log.info("[%s] session_start agent=%s session=%s msg=%r",
                  self._conv_id, agent_type, session_id, user_message[:200])

    def llm_call_start(self, phase: str, round_num: int | None = None):
        _log.debug("[%s] llm_call_start phase=%s round=%s", self._conv_id, phase, round_num)

    def llm_call_end(self, phase: str, duration: float, round_num: int | None = None):
        _log.debug("[%s] llm_call_end phase=%s duration=%.2fs round=%s",
                   self._conv_id, phase, duration, round_num)

    def plan(self, steps: list, complete: bool):
        _log.info("[%s] plan complete=%s steps=%d", self._conv_id, complete, len(steps))

    def tool_call(self, tool_name: str, tool_args: dict):
        _log.info("[%s] tool_call tool=%s", self._conv_id, tool_name)

    def error(self, error_type: str, detail: str):
        _log.error("[%s] %s: %s", self._conv_id, error_type, detail[:300])

    # Kept as no-ops for call-site compatibility
    def round_input(self, round_num: int, messages: list): pass
    def round_output(self, round_num: int, content: str): pass
    def sse_event(self, event: dict): pass
    def r_code_sent(self, execution_id: str, code: str, description: str): pass
    def r_result_received(self, execution_id: str, result: dict): pass
    def ask_user_sent(self, ask_id: str, question: str): pass
    def user_answered(self, ask_id: str, answer: str): pass
    def tool_result(self, tool_name: str, result: str): pass

    def flush(self):
        total = time.monotonic() - self._start
        _log.info("[%s] session_end total=%.2fs", self._conv_id, total)
