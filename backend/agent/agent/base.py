from __future__ import annotations
import asyncio
import uuid
import time
from typing import AsyncGenerator

from agent.llm import chat_completion, plan_completion, replan_completion
from agent.logger import AgentLogger


# -- Cancel support -----------------------------------------------------------
_cancel_events: dict[str, asyncio.Event] = {}


def request_cancel(user_id: str) -> bool:
    ev = _cancel_events.get(user_id)
    if ev:
        ev.set()
        return True
    return False


# -- Helpers ------------------------------------------------------------------

def _build_dataset_context(dataset_context: dict | None,
                           history: list | None,
                           other_dataframes: list[dict] | None = None) -> dict:
    """Build context dict from frontend-provided dataset info."""
    ctx: dict = {}
    if dataset_context:
        ctx["active_dataset"] = dataset_context
    if other_dataframes:
        ctx["other_datasets"] = other_dataframes
    if history:
        ctx["conversation_history"] = history
    return ctx


# -- Base Agent ---------------------------------------------------------------

class BaseAgent:
    def __init__(self, message: str, dataset_context: dict | None,
                 user_id: str, session_id: str,
                 history: list | None = None,
                 other_dataframes: list[dict] | None = None,
                 check_budget=None,
                 user_plan: str = "free"):
        self.message = message
        self.dataset_context = dataset_context
        self.user_id = user_id
        self.session_id = session_id
        self.check_budget = check_budget  # callable() -> bool
        self.user_plan = user_plan

        self.alog = AgentLogger()
        self.ds_context = _build_dataset_context(dataset_context, history, other_dataframes)

        self.cancel = asyncio.Event()
        if user_id:
            _cancel_events[user_id] = self.cancel

        self.result_queues: dict[str, asyncio.Queue] = {}
        self.tools_called: list[str] = []
        self.final_response = ""
        self._message_parts: list[str] = []
        self._cleaned_up = False

    async def run(self) -> AsyncGenerator[dict, None]:
        raise NotImplementedError
        yield  # make it a generator

    async def ask_user(self, question: str, description: str = "") -> AsyncGenerator[dict, None]:
        """Ask the user a question and await their answer."""
        ask_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue()
        self.result_queues[ask_id] = queue
        yield {
            "type": "ask_user",
            "ask_id": ask_id,
            "question": question,
            "description": description,
        }

    async def await_user_answer(self, ask_id: str, timeout: float = 300.0) -> str:
        """Wait for the user to answer a question."""
        queue = self.result_queues.get(ask_id)
        if not queue:
            return ""
        try:
            result = await asyncio.wait_for(queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            result = {"answer": ""}
        finally:
            self.result_queues.pop(ask_id, None)
        return result.get("answer", "")

    async def execute_r_code(self, code: str,
                             description: str) -> AsyncGenerator[dict, None]:
        """Send R code to frontend for execution, await result.

        Yields:
            r_code event (frontend executes this)

        After yielding, call await_r_result(execution_id) to get the result.
        """
        execution_id = str(uuid.uuid4())
        queue: asyncio.Queue = asyncio.Queue()
        self.result_queues[execution_id] = queue

        yield {
            "type": "r_code",
            "execution_id": execution_id,
            "code": code,
            "description": description,
        }

    async def await_r_result(self, execution_id: str,
                              timeout: float = 120.0) -> dict:
        """Wait for the frontend to POST the R execution result."""
        queue = self.result_queues.get(execution_id)
        if not queue:
            return {"success": False, "error": "No queue for execution_id"}

        try:
            result = await asyncio.wait_for(queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            result = {"success": False, "error": "R execution timed out"}
        finally:
            self.result_queues.pop(execution_id, None)

        return result

    def submit_result(self, execution_id: str, result: dict):
        """Called by the POST /chat/result endpoint."""
        queue = self.result_queues.get(execution_id)
        if queue:
            queue.put_nowait(result)

    def cleanup(self):
        """Call in finally block: remove cancel event, flush logs."""
        if self._cleaned_up:
            return
        self._cleaned_up = True
        if self.user_id:
            _cancel_events.pop(self.user_id, None)
        self.alog.flush()
