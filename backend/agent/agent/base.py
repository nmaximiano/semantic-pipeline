from __future__ import annotations
import asyncio
import re as _re
from typing import AsyncGenerator

from langchain_core.messages import ToolMessage
from agent.llm import get_llm
from agent.memory import get_history, append_turn
from agent.logger import AgentLogger


# ── Cancel support ──────────────────────────────────────────────────
_cancel_events: dict[str, asyncio.Event] = {}


def request_cancel(user_id: str) -> bool:
    ev = _cancel_events.get(user_id)
    if ev:
        ev.set()
        return True
    return False


# ── Helpers ──────────────────────────────────────────────────────────

def _tool_descriptions(tools) -> str:
    """Tool names + descriptions as plain text for the planner."""
    lines = []
    for t in tools:
        desc = t.description or ""
        schema = t.args_schema
        params = ""
        if schema and hasattr(schema, "schema"):
            try:
                s = schema.schema()
                props = s.get("properties", {})
                if props:
                    parts = []
                    for pname, pinfo in props.items():
                        ptype = pinfo.get("type", "any")
                        pdesc = pinfo.get("description", "")
                        parts.append(f"    {pname} ({ptype}): {pdesc}")
                    params = "\n".join(parts)
            except Exception:
                pass
        lines.append(f"- {t.name}: {desc}")
        if params:
            lines.append(f"  Parameters:\n{params}")
    return "\n".join(lines)


def _build_dataset_context(dataset_info, open_datasets, history) -> dict:
    ctx: dict = {}
    if dataset_info:
        ctx["active_dataset"] = {
            "id": dataset_info.get("id"),
            "filename": dataset_info.get("filename"),
            "columns": dataset_info.get("columns", []),
            "row_count": dataset_info.get("row_count", 0),
            "col_avg_chars": dataset_info.get("col_avg_chars", {}),
        }
    if open_datasets:
        ctx["open_datasets"] = [
            {"id": ds.get("id"), "filename": ds.get("filename"),
             "columns": ds.get("columns", []), "row_count": ds.get("row_count", 0)}
            for ds in open_datasets
        ]
    if history:
        ctx["conversation_history"] = history
    return ctx


def _save_turn(session_id, user_message, assistant_response, tools_called):
    if not session_id:
        return
    try:
        append_turn(session_id, user_message, assistant_response,
                    tools_called or None)
    except Exception:
        pass


async def _poll_job(tool_name: str, job_id: str,
                    cancel: asyncio.Event | None = None) -> AsyncGenerator[dict, None]:
    from services import supabase_admin

    last_progress = -1
    while True:
        await asyncio.sleep(1)
        if cancel and cancel.is_set():
            yield {"type": "_result", "value": "Cancelled by user."}
            return
        try:
            job = (
                supabase_admin.table("jobs")
                .select("status, rows_processed, rows_total")
                .eq("id", job_id)
                .single()
                .execute()
            )
        except Exception:
            return

        if not job.data:
            return

        j = job.data
        total = j["rows_total"] or 1
        processed = j["rows_processed"] or 0

        if j["status"] == "completed":
            yield {"type": "tool_progress", "tool": tool_name, "progress": 100}
            yield {"type": "_result", "value": f"Transform completed: {total} rows processed, new column added."}
            return

        if j["status"] == "failed":
            progress = round(processed / total * 100)
            yield {"type": "tool_progress", "tool": tool_name, "progress": progress}
            yield {"type": "_result", "value": f"Transform failed after processing {processed}/{total} rows."}
            return

        progress = round(processed / total * 100)
        if progress != last_progress:
            yield {"type": "tool_progress", "tool": tool_name, "progress": progress}
            last_progress = progress


# ── Base Agent ──────────────────────────────────────────────────────

class BaseAgent:
    def __init__(self, message, dataset_info, user_id, session_id, open_datasets):
        from agent.tools import make_tools

        self.message = message
        self.dataset_info = dataset_info
        self.user_id = user_id
        self.session_id = session_id
        self.open_datasets = open_datasets

        self.alog = AgentLogger()
        self.llm = get_llm()

        dataset_id = dataset_info["id"] if dataset_info else None
        self.data_tools = []
        if dataset_id and user_id:
            self.data_tools = make_tools(dataset_id, user_id, open_datasets, session_id)
        self.tool_map = {t.name: t for t in self.data_tools}
        self.tool_llm = self.llm.bind_tools(self.data_tools)

        history = get_history(session_id) if session_id else []
        self.ds_context = _build_dataset_context(dataset_info, open_datasets, history)

        self.cancel = asyncio.Event()
        if user_id:
            _cancel_events[user_id] = self.cancel

        self.tools_called: list[str] = []
        self.final_response = ""
        self._message_parts: list[str] = []
        self._error_streak: dict[str, int] = {}
        self._pending_tool_messages: list = []
        self._cleaned_up = False

    async def run(self) -> AsyncGenerator[dict, None]:
        raise NotImplementedError
        yield  # make it a generator

    async def execute_tool_calls(self, response) -> AsyncGenerator[dict, None]:
        """Yields SSE events (tool_start/progress/end).
        Populates self._pending_tool_messages with ToolMessages."""
        self._pending_tool_messages = []
        for tc in response.tool_calls:
            name = tc["name"]

            if name not in self.tools_called:
                self.tools_called.append(name)

            yield {"type": "tool_start", "tool": name, "args": tc["args"]}

            tool_fn = self.tool_map.get(name)
            if tool_fn is None:
                result = f"Unknown tool: {name}"
            else:
                try:
                    result = await tool_fn.ainvoke(tc["args"])
                except Exception as e:
                    self.alog(f"Tool {name} failed: {e}")
                    result = f"Tool error: {e}"

            # Poll llm_transform_tool job progress
            if name == "llm_transform_tool" and "Job ID:" in str(result):
                job_match = _re.search(r"Job ID: ([a-f0-9-]+)", str(result))
                if job_match:
                    async for event in _poll_job(name, job_match.group(1), self.cancel):
                        if event["type"] == "_result":
                            result = event["value"]
                        else:
                            yield event

            result_str = str(result)
            self.alog.tool_result(name, result_str)

            # Error streak detection
            is_error = (
                result_str.startswith("Error:")
                or result_str.startswith("Tool error:")
                or "not found" in result_str.lower()
                or "failed" in result_str.lower()
            )
            if is_error:
                self._error_streak[name] = self._error_streak.get(name, 0) + 1
                if self._error_streak[name] >= 2:
                    result_str += (
                        "\n\n[SYSTEM] This tool has failed multiple times. "
                        "The plan will be updated to try a different approach."
                    )
            else:
                self._error_streak.pop(name, None)

            yield {"type": "tool_end", "tool": name, "result": result_str}
            self._pending_tool_messages.append(
                ToolMessage(content=result_str, tool_call_id=tc["id"])
            )

    def cleanup(self):
        """Call in finally block: remove cancel event, flush logs, save turn."""
        if self._cleaned_up:
            return
        self._cleaned_up = True
        if self.user_id:
            _cancel_events.pop(self.user_id, None)
        self.alog.flush()
        full_response = "\n\n".join(self._message_parts) if self._message_parts else self.final_response
        _save_turn(self.session_id, self.message, full_response, self.tools_called)
