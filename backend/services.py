"""Shared business logic for the Semantic Pipeline backend.

This module owns the core processing functions (credits, jobs, LLM calls,
dataset I/O) so that both the FastAPI endpoints and the agent tools can
use them without depending on each other.

All dataset mutations operate via in-place SQL on the JSONB dataset_rows
table — no pandas, no load-all-into-memory.
"""

import asyncio
import contextlib
import logging
import os
import re
from datetime import datetime, timezone

import httpx
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import execute_values, Json
from dotenv import load_dotenv
from openai import AsyncOpenAI
from supabase import create_client, Client

load_dotenv()
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

supabase_url = os.getenv("SUPABASE_URL")
supabase_service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
supabase_admin: Client = create_client(supabase_url, supabase_service_key)

DATABASE_URL = os.getenv("DATABASE_URL")
_pg_pool = ThreadedConnectionPool(minconn=1, maxconn=10, dsn=DATABASE_URL)


@contextlib.contextmanager
def get_pg_conn():
    """Get a connection from the pool, auto-return on exit."""
    conn = _pg_pool.getconn()
    try:
        yield conn
    finally:
        _pg_pool.putconn(conn)


llm_client = AsyncOpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MODEL = "openai/gpt-oss-20b:nitro"
MAX_CHARS_PER_OBSERVATION = 4_000
MAX_BATCH_CHARS = 40_000
MAX_BATCH_SIZE = 50
MAX_CONCURRENT_LLM_CALLS = 50
MAX_RETRY_ATTEMPTS = 5
RETRY_BASE_DELAY = 1.0  # seconds, for exponential backoff on 429s


# Regex for safe column names in SQL JSONB key references
_SAFE_COL_RE = re.compile(r"^[^'\"\\;]+$")

# ---------------------------------------------------------------------------
# Job cancellation
# ---------------------------------------------------------------------------

_cancel_events: dict[str, asyncio.Event] = {}


def request_cancel(job_id: str):
    """Signal a running job to stop processing new batches."""
    if job_id in _cancel_events:
        _cancel_events[job_id].set()

SYSTEM_PROMPT = """You are a data transformation function.
Given input text, you produce a single, clean output value.
Do not include explanations or extra text."""

# ---------------------------------------------------------------------------
# Infrastructure helpers
# ---------------------------------------------------------------------------


def _safe_col(name: str) -> str:
    """Validate a column name is safe for use in SQL JSONB key references.

    Column names are used inside single-quoted JSONB accessors like
    ``data->>'col_name'``, so the only truly dangerous characters are
    single quotes, double quotes, backslashes, and semicolons.
    Everything else (spaces, %, #, etc.) is safe inside Postgres strings.
    """
    if not name or len(name) > 200 or not _SAFE_COL_RE.match(name):
        raise ValueError(f"Unsafe column name: {name!r}")
    return name


def _q(name: str) -> str:
    """Escape a column name for use in f-string SQL passed to cur.execute().

    psycopg2 interprets ``%`` as a format specifier (e.g. ``%s``).
    Column names like ``Change %`` must have ``%`` doubled to ``%%``
    so psycopg2 doesn't try to substitute them.
    """
    return name.replace("%", "%%")


def verify_dataset_ownership(dataset_id: str, user_id: str) -> dict:
    """Verify user owns the dataset. Returns the full metadata row.

    Raises ValueError if dataset not found or not owned by user.
    """
    result = (
        supabase_admin.table("datasets")
        .select("*")
        .eq("id", dataset_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not result.data:
        raise ValueError("Dataset not found")
    return result.data


def update_dataset_metadata_sql(dataset_id: str, columns: list[str]):
    """Recompute and save row_count, col_avg_chars, file_size_bytes from SQL aggregates."""
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s",
                (dataset_id,),
            )
            row_count = cur.fetchone()[0]

            col_avg_chars = {}
            for col in columns:
                cur.execute(
                    "SELECT COALESCE(ROUND(AVG(LENGTH(COALESCE(data->>%s, '')))::numeric, 1), 0) "
                    "FROM dataset_rows WHERE dataset_id = %s",
                    (col, dataset_id),
                )
                col_avg_chars[col] = float(cur.fetchone()[0])

    ncols = len(columns)
    header_size = sum(len(c) + 3 for c in columns)
    avg_row_size = sum(col_avg_chars.get(c, 0) for c in columns) + 3 * ncols
    file_size_bytes = int(header_size + avg_row_size * row_count)

    supabase_admin.table("datasets").update({
        "columns": columns,
        "row_count": row_count,
        "col_avg_chars": col_avg_chars,
        "file_size_bytes": file_size_bytes,
    }).eq("id", dataset_id).execute()



# ---------------------------------------------------------------------------
# Job helpers
# ---------------------------------------------------------------------------


def create_job(user_id: str, filename: str, column_name: str, prompt: str,
               new_column_name: str, rows_total: int) -> str:
    """Create a job record. Returns job ID."""
    result = supabase_admin.table("jobs").insert({
        "user_id": user_id,
        "status": "pending",
        "filename": filename,
        "column_name": column_name,
        "prompt": prompt,
        "new_column_name": new_column_name,
        "rows_total": rows_total,
        "rows_processed": 0,
    }).execute()
    return result.data[0]["id"]


def update_job(job_id: str, **kwargs):
    """Update job fields."""
    supabase_admin.table("jobs").update(kwargs).eq("id", job_id).execute()

# ---------------------------------------------------------------------------
# OpenRouter / LLM helpers
# ---------------------------------------------------------------------------


async def get_openrouter_balance() -> float:
    """Query OpenRouter for current account balance (dollars). Returns -1 if unknown."""
    try:
        async with httpx.AsyncClient() as http:
            resp = await http.get(
                "https://openrouter.ai/api/v1/key",
                headers={"Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY')}"},
                timeout=5.0,
            )
            if resp.status_code == 200:
                data = resp.json().get("data", {})
                remaining = data.get("limit_remaining")
                if remaining is not None:
                    return float(remaining)
                limit = data.get("limit")
                usage = data.get("usage", 0)
                if limit is not None:
                    return max(0.0, float(limit) - float(usage))
    except Exception as e:
        log.warning(f"Failed to query OpenRouter balance: {e}")
    return -1.0


def get_concurrency_limit(balance: float) -> int:
    """Derive max concurrent LLM calls from OpenRouter balance ($1 = 1 RPS, max 500)."""
    if balance < 0:
        return MAX_CONCURRENT_LLM_CALLS
    return max(1, min(int(balance), 500))


async def get_generation_cost(generation_id: str) -> float | None:
    """Query OpenRouter for the cost of a completed generation."""
    try:
        async with httpx.AsyncClient() as http:
            resp = await http.get(
                f"https://openrouter.ai/api/v1/generation?id={generation_id}",
                headers={"Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY')}"},
                timeout=5.0,
            )
            if resp.status_code == 200:
                return resp.json().get("data", {}).get("total_cost")
    except Exception:
        pass
    return None


async def apply_llm(text: str, instructions: str) -> str:
    """Single-row LLM call. Used as fallback for failed batch items."""
    if text is None or str(text).strip() == "":
        return ""
    for attempt in range(MAX_RETRY_ATTEMPTS):
        try:
            response = await llm_client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": instructions},
                    {"role": "assistant", "content": "Understood. Send me the text and I will respond with only the output value."},
                    {"role": "user", "content": text},
                ],
                extra_body={"reasoning": {"effort": "minimal"}},
            )
            usage = response.usage
            cost = await get_generation_cost(response.id) or 0.0
            log.info(f"Tokens: {usage.prompt_tokens} prompt, {usage.completion_tokens} completion | Cost: ${cost:.6f}")
            return response.choices[0].message.content.strip()
        except Exception as e:
            if hasattr(e, 'status_code') and e.status_code == 429 and attempt < MAX_RETRY_ATTEMPTS - 1:
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                log.warning(f"Rate limited (429), retrying in {delay:.1f}s (attempt {attempt + 1}/{MAX_RETRY_ATTEMPTS})")
                await asyncio.sleep(delay)
                continue
            raise
    return ""


def create_batches(texts: list[str]) -> tuple[list[list[tuple[int, str]]], dict[int, str]]:
    """Greedy-pack texts into batches. Returns (batches, skipped)."""
    batches: list[list[tuple[int, str]]] = []
    skipped: dict[int, str] = {}
    current_batch: list[tuple[int, str]] = []
    current_chars = 0

    for idx, text in enumerate(texts):
        if text is None or str(text).strip() == "":
            skipped[idx] = ""
            continue

        text = str(text)
        text_len = len(text)

        if current_batch and (current_chars + text_len > MAX_BATCH_CHARS or len(current_batch) >= MAX_BATCH_SIZE):
            batches.append(current_batch)
            current_batch = []
            current_chars = 0

        current_batch.append((idx, text))
        current_chars += text_len

    if current_batch:
        batches.append(current_batch)

    return batches, skipped


async def apply_llm_batch(texts: list[tuple[int, str]], instructions: str) -> dict[int, str]:
    """Batch LLM call. Falls back to single-row only for items that failed to parse."""
    numbered_lines = []
    index_map: dict[int, int] = {}
    for pos, (orig_idx, text) in enumerate(texts, start=1):
        numbered_lines.append(f'{pos}: """{text}"""')
        index_map[pos] = orig_idx

    batch_prompt = (
        f"{instructions}\n\n"
        "Respond with one result per line, numbered to match. Example format:\n"
        "1: positive\n"
        "2: negative\n\n"
        "Texts:\n" + "\n".join(numbered_lines)
    )

    raw = None
    for attempt in range(MAX_RETRY_ATTEMPTS):
        try:
            response = await llm_client.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": batch_prompt},
                ],
                extra_body={"reasoning": {"effort": "minimal"}},
            )
            usage = response.usage
            cost = await get_generation_cost(response.id) or 0.0
            log.info(f"Batch ({len(texts)} items) tokens: {usage.prompt_tokens} prompt, {usage.completion_tokens} completion | Cost: ${cost:.6f}")
            raw = response.choices[0].message.content.strip()
            break
        except Exception as e:
            if hasattr(e, 'status_code') and e.status_code == 429 and attempt < MAX_RETRY_ATTEMPTS - 1:
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                log.warning(f"Batch rate limited (429), retrying in {delay:.1f}s (attempt {attempt + 1}/{MAX_RETRY_ATTEMPTS})")
                await asyncio.sleep(delay)
                continue
            log.error(f"Batch LLM call failed: {e}")
            results: dict[int, str] = {}
            for orig_idx, text in texts:
                try:
                    results[orig_idx] = await apply_llm(text, instructions)
                except Exception as e2:
                    log.error(f"Row {orig_idx} failed: {e2}")
                    results[orig_idx] = f"ERROR: {e2}"
            return results

    # Parse "N: result" lines
    results = {}
    for line in raw.splitlines():
        m = re.match(r"^(\d+):\s*(.*)$", line)
        if m:
            pos = int(m.group(1))
            if pos in index_map:
                results[index_map[pos]] = m.group(2).strip()

    # Only retry the specific items that failed to parse
    missing = [(orig_idx, text) for orig_idx, text in texts if orig_idx not in results]
    if missing:
        log.warning(f"Batch parse: got {len(results)}/{len(texts)}, retrying {len(missing)} individually")
        for orig_idx, text in missing:
            try:
                results[orig_idx] = await apply_llm(text, instructions)
            except Exception as e:
                log.error(f"Row {orig_idx} failed: {e}")
                results[orig_idx] = f"ERROR: {e}"

    return results

# ---------------------------------------------------------------------------
# Dataset helpers — row I/O
# ---------------------------------------------------------------------------


def fetch_all_dataset_rows(dataset_id: str) -> list[dict]:
    """Fetch all rows from dataset_rows via direct Postgres query."""
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT row_number, data FROM dataset_rows WHERE dataset_id = %s ORDER BY row_number",
                (dataset_id,),
            )
            return [{"row_number": r, "data": d} for r, d in cur.fetchall()]


def write_dataset_rows(dataset_id: str, df):
    """Delete existing rows and bulk-insert new ones from a DataFrame via direct Postgres.

    Used only at upload time (the only place pandas is needed).
    """
    import pandas as pd
    values = []
    for i, (_, row) in enumerate(df.iterrows()):
        data = {col: (None if pd.isna(val) else val) for col, val in row.items()}
        values.append((dataset_id, i, Json(data)))

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM dataset_rows WHERE dataset_id = %s", (dataset_id,))
            if values:
                execute_values(
                    cur,
                    "INSERT INTO dataset_rows (dataset_id, row_number, data) VALUES %s",
                    values,
                    template="(%s, %s, %s)",
                    page_size=1000,
                )
        conn.commit()


def write_original_rows(dataset_id: str, df):
    """Bulk-insert rows into dataset_rows_original. Used at upload time only."""
    import pandas as pd
    values = []
    for i, (_, row) in enumerate(df.iterrows()):
        data = {col: (None if pd.isna(val) else val) for col, val in row.items()}
        values.append((dataset_id, i, Json(data)))

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM dataset_rows_original WHERE dataset_id = %s", (dataset_id,))
            if values:
                execute_values(
                    cur,
                    "INSERT INTO dataset_rows_original (dataset_id, row_number, data) VALUES %s",
                    values,
                    template="(%s, %s, %s)",
                    page_size=1000,
                )
        conn.commit()


# ---------------------------------------------------------------------------
# Dataset cloning
# ---------------------------------------------------------------------------


def clone_dataset(source_dataset_id: str, user_id: str) -> str:
    """Create an independent copy of a library dataset for session isolation.

    Copies metadata, dataset_rows, and dataset_rows_original.
    Does NOT copy pipeline_steps — clones start fresh.
    Returns the new clone's dataset ID.
    """
    import uuid

    # Read source metadata
    src = (
        supabase_admin.table("datasets")
        .select("user_id, filename, columns, original_columns, row_count, col_avg_chars, file_size_bytes")
        .eq("id", source_dataset_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not src.data:
        raise ValueError("Source dataset not found")

    clone_id = str(uuid.uuid4())

    # Create clone metadata row
    supabase_admin.table("datasets").insert({
        "id": clone_id,
        "user_id": src.data["user_id"],
        "filename": src.data["filename"],
        "storage_path": "clone",
        "columns": src.data["columns"],
        "original_columns": src.data["original_columns"],
        "row_count": src.data["row_count"],
        "col_avg_chars": src.data["col_avg_chars"],
        "file_size_bytes": src.data["file_size_bytes"],
        "source_dataset_id": source_dataset_id,
    }).execute()

    # Copy rows via SQL (no pandas, no materialization)
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO dataset_rows (dataset_id, row_number, data) "
                "SELECT %s, row_number, data FROM dataset_rows WHERE dataset_id = %s",
                (clone_id, source_dataset_id),
            )
            cur.execute(
                "INSERT INTO dataset_rows_original (dataset_id, row_number, data) "
                "SELECT %s, row_number, data FROM dataset_rows_original WHERE dataset_id = %s",
                (clone_id, source_dataset_id),
            )
        conn.commit()

    return clone_id


# ---------------------------------------------------------------------------
# Dataset mutations — all via SQL
# ---------------------------------------------------------------------------


def rename_column(dataset_id: str, user_id: str, old_name: str, new_name: str) -> dict:
    """Rename a column in the dataset via SQL."""
    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if old_name not in columns:
        raise ValueError(f"Column '{old_name}' does not exist")
    if new_name in columns:
        raise ValueError(f"Column '{new_name}' already exists")

    _safe_col(old_name)
    _safe_col(new_name)

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE dataset_rows "
                "SET data = (data - %s) || jsonb_build_object(%s, data->%s) "
                "WHERE dataset_id = %s AND data ? %s",
                (old_name, new_name, old_name, dataset_id, old_name),
            )
        conn.commit()

    new_columns = [new_name if c == old_name else c for c in columns]
    update_dataset_metadata_sql(dataset_id, new_columns)
    record_pipeline_step(dataset_id, "rename_column",
                         {"old_name": old_name, "new_name": new_name})
    return {"columns": new_columns, "row_count": ds["row_count"]}


def duplicate_column(dataset_id: str, user_id: str, column_name: str,
                     new_column_name: str) -> dict:
    """Duplicate a column under a new name."""
    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if column_name not in columns:
        raise ValueError(f"Column '{column_name}' does not exist")
    if new_column_name in columns:
        raise ValueError(f"Column '{new_column_name}' already exists")

    _safe_col(column_name)
    _safe_col(new_column_name)

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE dataset_rows "
                "SET data = data || jsonb_build_object(%s, data->%s) "
                "WHERE dataset_id = %s",
                (new_column_name, column_name, dataset_id),
            )
        conn.commit()

    new_columns = columns + [new_column_name]
    update_dataset_metadata_sql(dataset_id, new_columns)
    record_pipeline_step(dataset_id, "duplicate_column",
                         {"column_name": column_name,
                          "new_column_name": new_column_name})
    return {"columns": new_columns, "new_column": new_column_name,
            "row_count": ds["row_count"]}


def delete_column(dataset_id: str, user_id: str, column_name: str) -> dict:
    """Delete a column from the dataset via SQL."""
    return delete_columns(dataset_id, user_id, [column_name])


def delete_columns(dataset_id: str, user_id: str, column_names: list[str]) -> dict:
    """Delete one or more columns from the dataset via SQL."""
    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]

    for col in column_names:
        if col not in columns:
            raise ValueError(f"Column '{col}' does not exist")
        _safe_col(col)

    remaining = [c for c in columns if c not in column_names]
    if not remaining:
        raise ValueError("Cannot delete all columns — at least one must remain")

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            # Chain JSONB removal: data - 'col1' - 'col2' - ...
            removals = " - ".join(["%s"] * len(column_names))
            cur.execute(
                f"UPDATE dataset_rows SET data = data - {removals} "
                f"WHERE dataset_id = %s",
                (*column_names, dataset_id),
            )
        conn.commit()

    update_dataset_metadata_sql(dataset_id, remaining)
    for col in column_names:
        record_pipeline_step(dataset_id, "delete_column", {"column_name": col})
    return {"columns": remaining, "deleted": column_names, "row_count": ds["row_count"]}


def find_replace(dataset_id: str, user_id: str, column_name: str,
                 find_value: str, replace_value: str) -> dict:
    """Replace occurrences of find_value with replace_value in a column via SQL."""
    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if column_name not in columns:
        raise ValueError(f"Column '{column_name}' does not exist")

    _safe_col(column_name)

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            # Count affected rows first
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows "
                "WHERE dataset_id = %s AND data->>%s LIKE %s",
                (dataset_id, column_name, f"%{find_value}%"),
            )
            changed = cur.fetchone()[0]

            cur.execute(
                "UPDATE dataset_rows "
                "SET data = jsonb_set(data, ARRAY[%s], "
                "    to_jsonb(REPLACE(COALESCE(data->>%s, ''), %s, %s))) "
                "WHERE dataset_id = %s AND data->>%s LIKE %s",
                (column_name, column_name, find_value, replace_value,
                 dataset_id, column_name, f"%{find_value}%"),
            )
        conn.commit()

    update_dataset_metadata_sql(dataset_id, columns)
    record_pipeline_step(
        dataset_id, "find_replace",
        {"column_name": column_name, "find_value": find_value, "replace_value": replace_value},
        result_summary=f"{changed} cells changed",
    )
    return {"column": column_name, "cells_changed": changed, "row_count": ds["row_count"]}


# ---------------------------------------------------------------------------
# Filter rows
# ---------------------------------------------------------------------------

_NUMERIC_RE = r'^-?[0-9]+(\.[0-9]+)?$'


def _build_filter_condition(column_name: str, operator: str, value: str = "") -> tuple[str, list]:
    """Build a parameterized SQL WHERE clause for a filter operator.

    Returns (sql_fragment, params) where sql_fragment uses %s placeholders.
    The fragment is a condition that is TRUE for rows that MATCH (should be kept).
    """
    _safe_col(column_name)
    col_ref = "data->>%s"
    params_prefix = [column_name]

    if operator == "is_empty":
        return (f"({col_ref} IS NULL OR TRIM({col_ref}) = '')", params_prefix + [column_name])
    elif operator == "is_not_empty":
        return (f"({col_ref} IS NOT NULL AND TRIM({col_ref}) != '')", params_prefix + [column_name])
    elif operator == "contains":
        return (f"{col_ref} ILIKE %s", params_prefix + [f"%{value}%"])
    elif operator == "not_contains":
        return (f"({col_ref} IS NULL OR {col_ref} NOT ILIKE %s)", params_prefix + [column_name, f"%{value}%"])
    elif operator == "in":
        vals = [v.strip() for v in value.split(",")]
        placeholders = ", ".join(["%s"] * len(vals))
        return (f"({col_ref} IN ({placeholders}))", params_prefix + vals)
    elif operator == "not_in":
        vals = [v.strip() for v in value.split(",")]
        placeholders = ", ".join(["%s"] * len(vals))
        return (f"({col_ref} IS NULL OR {col_ref} NOT IN ({placeholders}))", params_prefix + [column_name] + vals)
    elif operator in ("=", "!=", ">", "<", ">=", "<="):
        # Try numeric comparison if value looks numeric
        sql_ops = {"=": "=", "!=": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<="}
        sql_op = sql_ops[operator]
        # Use CASE to attempt numeric comparison, fall back to string
        cond = (
            f"CASE WHEN {col_ref} ~ '{_NUMERIC_RE}' AND %s ~ '{_NUMERIC_RE}' "
            f"THEN ({col_ref})::numeric {sql_op} (%s)::numeric "
            f"ELSE {col_ref} {sql_op} %s END"
        )
        return (cond, params_prefix + [value, column_name, value, column_name, value])
    else:
        raise ValueError(f"Unsupported operator '{operator}'. "
                         "Use: =, !=, >, <, >=, <=, contains, not_contains, "
                         "is_empty, is_not_empty, in, not_in")


def filter_rows(dataset_id: str, user_id: str, column_name: str,
                operator: str, value: str = "") -> dict:
    """Filter rows by a condition on a column. Keeps rows that match."""
    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if column_name not in columns:
        raise ValueError(f"Column '{column_name}' does not exist")

    condition, params = _build_filter_condition(column_name, operator, value)

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            # Count before
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s",
                (dataset_id,),
            )
            original_count = cur.fetchone()[0]

            # Delete rows that do NOT match the condition
            cur.execute(
                f"DELETE FROM dataset_rows WHERE dataset_id = %s AND NOT ({condition})",
                [dataset_id] + params,
            )
            removed = cur.rowcount
        conn.commit()

    remaining = original_count - removed
    update_dataset_metadata_sql(dataset_id, columns)
    record_pipeline_step(
        dataset_id, "filter_rows",
        {"column_name": column_name, "operator": operator, "value": value},
        result_summary=f"Removed {removed} rows, {remaining} remaining",
    )
    return {"columns": columns, "row_count": remaining, "rows_removed": removed}


# ---------------------------------------------------------------------------
# Sort dataset
# ---------------------------------------------------------------------------

_SORT_TYPES = {"text", "numeric", "date"}


def sort_dataset(dataset_id: str, user_id: str, column_name: str,
                 direction: str = "asc",
                 sort_type: str = "text") -> dict:
    """Sort dataset rows by a column, reassigning row_number to persist order.

    Parameters:
        column_name: column to sort by
        direction: 'asc' or 'desc'
        sort_type: 'text', 'numeric', or 'date'
    """
    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if column_name not in columns:
        raise ValueError(f"Column '{column_name}' does not exist")
    if direction not in ("asc", "desc"):
        raise ValueError("direction must be 'asc' or 'desc'")
    if sort_type not in _SORT_TYPES:
        raise ValueError(
            f"Unsupported sort_type '{sort_type}'. "
            f"Use one of: {', '.join(sorted(_SORT_TYPES))}"
        )

    _safe_col(column_name)
    sql_dir = "ASC" if direction == "asc" else "DESC"
    nulls = "NULLS LAST" if direction == "asc" else "NULLS FIRST"

    col_ref = f"data->>'{_q(column_name)}'"

    if sort_type == "numeric":
        order_expr = (
            f"CASE WHEN {col_ref} ~ '^-?[0-9]+(\\.[0-9]+)?$' "
            f"THEN ({col_ref})::numeric ELSE NULL END {sql_dir} {nulls}"
        )
    elif sort_type == "date":
        order_expr = (
            f"CASE "
            f"WHEN {col_ref} ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}' "
            f"  THEN ({col_ref})::timestamp "
            f"WHEN {col_ref} ~ '^\\d{{1,2}}/\\d{{1,2}}/\\d{{4}}' "
            f"  THEN TO_TIMESTAMP({col_ref}, 'MM/DD/YYYY') "
            f"WHEN {col_ref} ~ '^[A-Za-z]{{3}} \\d{{1,2}}, \\d{{4}}' "
            f"  THEN TO_TIMESTAMP({col_ref}, 'Mon DD, YYYY') "
            f"WHEN {col_ref} ~ '^[A-Za-z]+ \\d{{1,2}}, \\d{{4}}' "
            f"  THEN TO_TIMESTAMP({col_ref}, 'FMMonth DD, YYYY') "
            f"ELSE NULL END {sql_dir} {nulls}"
        )
    else:
        order_expr = f"{col_ref} {sql_dir} {nulls}"

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            # Two-step reassign: offset to negative temporaries first to
            # avoid unique-constraint collisions on (dataset_id, row_number),
            # then set final values.
            cur.execute(f"""
                WITH sorted AS (
                    SELECT ctid,
                           ROW_NUMBER() OVER (ORDER BY {order_expr}, ctid) AS new_rn
                    FROM dataset_rows
                    WHERE dataset_id = %s
                )
                UPDATE dataset_rows dr
                SET row_number = -s.new_rn
                FROM sorted s
                WHERE dr.ctid = s.ctid
            """, (dataset_id,))
            cur.execute("""
                UPDATE dataset_rows
                SET row_number = -row_number
                WHERE dataset_id = %s AND row_number < 0
            """, (dataset_id,))
            row_count = cur.rowcount
        conn.commit()

    record_pipeline_step(
        dataset_id, "sort_dataset",
        {"column_name": column_name, "direction": direction,
         "sort_type": sort_type},
        result_summary=f"Sorted {row_count} rows by {column_name} {direction} ({sort_type})",
    )
    return {
        "columns": columns,
        "row_count": row_count,
        "sorted_by": column_name,
        "direction": direction,
    }


# ---------------------------------------------------------------------------
# Window aggregate
# ---------------------------------------------------------------------------

ALLOWED_AGGREGATIONS = {"mean", "sum", "min", "max", "median", "std"}

# Map our aggregation names to SQL aggregate functions
_SQL_AGG_MAP = {
    "mean": "AVG",
    "sum": "SUM",
    "min": "MIN",
    "max": "MAX",
    "std": "STDDEV",
}


def window_aggregate(dataset_id: str, user_id: str, column_name: str,
                     window: int, aggregation: str, new_column_name: str) -> dict:
    """Compute a rolling window aggregation on a numeric column via SQL."""
    if aggregation not in ALLOWED_AGGREGATIONS:
        raise ValueError(
            f"Unsupported aggregation '{aggregation}'. "
            f"Use one of: {', '.join(sorted(ALLOWED_AGGREGATIONS))}"
        )
    if window < 2:
        raise ValueError("Window size must be at least 2")

    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if column_name not in columns:
        raise ValueError(f"Column '{column_name}' does not exist")
    if new_column_name in columns:
        raise ValueError(f"Column '{new_column_name}' already exists")

    _safe_col(column_name)
    _safe_col(new_column_name)

    if aggregation == "median":
        # No SQL window function for rolling median — compute in Python
        # Read only the source column to keep memory minimal
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT row_number, data->>%s FROM dataset_rows "
                    "WHERE dataset_id = %s ORDER BY row_number",
                    (column_name, dataset_id),
                )
                rows_data = cur.fetchall()

        # Compute rolling median in Python
        import statistics
        row_numbers = []
        values = []
        for rn, val in rows_data:
            row_numbers.append(rn)
            try:
                values.append(float(val)) if val is not None else values.append(None)
            except (ValueError, TypeError):
                values.append(None)

        updates = []
        for i in range(len(values)):
            if i < window - 1:
                updates.append((row_numbers[i], None))
                continue
            win_vals = [v for v in values[i - window + 1:i + 1] if v is not None]
            if len(win_vals) >= window:
                med = round(statistics.median(win_vals), 4)
                updates.append((row_numbers[i], str(med)))
            else:
                updates.append((row_numbers[i], None))

        # Bulk update
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                for rn, val in updates:
                    if val is not None:
                        cur.execute(
                            "UPDATE dataset_rows SET data = data || jsonb_build_object(%s, %s) "
                            "WHERE dataset_id = %s AND row_number = %s",
                            (new_column_name, val, dataset_id, rn),
                        )
                    else:
                        cur.execute(
                            "UPDATE dataset_rows SET data = data || jsonb_build_object(%s, null) "
                            "WHERE dataset_id = %s AND row_number = %s",
                            (new_column_name, dataset_id, rn),
                        )
            conn.commit()
    else:
        sql_agg = _SQL_AGG_MAP[aggregation]
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"""
                    WITH windowed AS (
                        SELECT row_number,
                            ROUND({sql_agg}(
                                CASE WHEN data->>%s ~ '{_NUMERIC_RE}'
                                     THEN (data->>%s)::numeric ELSE NULL END
                            ) OVER (ORDER BY row_number ROWS BETWEEN %s PRECEDING AND CURRENT ROW), 4) AS val,
                            COUNT(
                                CASE WHEN data->>%s ~ '{_NUMERIC_RE}'
                                     THEN 1 ELSE NULL END
                            ) OVER (ORDER BY row_number ROWS BETWEEN %s PRECEDING AND CURRENT ROW) AS window_count
                        FROM dataset_rows WHERE dataset_id = %s
                    )
                    UPDATE dataset_rows dr
                    SET data = dr.data || jsonb_build_object(%s,
                        CASE WHEN w.window_count >= %s THEN w.val::text ELSE NULL END)
                    FROM windowed w
                    WHERE dr.dataset_id = %s AND dr.row_number = w.row_number
                """, (column_name, column_name, window - 1,
                      column_name, window - 1, dataset_id,
                      new_column_name, window, dataset_id))
            conn.commit()

    new_columns = columns + [new_column_name]
    update_dataset_metadata_sql(dataset_id, new_columns)

    # Count non-null values
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s AND data->>%s IS NOT NULL",
                (dataset_id, new_column_name),
            )
            non_null = cur.fetchone()[0]
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s",
                (dataset_id,),
            )
            total = cur.fetchone()[0]

    record_pipeline_step(
        dataset_id, "window_aggregate",
        {"column_name": column_name, "window": window, "aggregation": aggregation,
         "new_column_name": new_column_name},
    )

    return {
        "columns": new_columns,
        "row_count": total,
        "new_column": new_column_name,
        "non_null": non_null,
        "null": total - non_null,
    }


def shift_column(dataset_id: str, user_id: str, column_name: str,
                 periods: int, new_column_name: str) -> dict:
    """Create a new column by shifting an existing column by N rows via SQL."""
    if periods == 0:
        raise ValueError("Periods must be non-zero")

    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if column_name not in columns:
        raise ValueError(f"Column '{column_name}' does not exist")
    if new_column_name in columns:
        raise ValueError(f"Column '{new_column_name}' already exists")

    _safe_col(column_name)
    _safe_col(new_column_name)

    # LAG for positive periods (look back), LEAD for negative (look forward)
    if periods > 0:
        shift_fn = "LAG"
        shift_amount = periods
    else:
        shift_fn = "LEAD"
        shift_amount = abs(periods)

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                WITH shifted AS (
                    SELECT row_number,
                           {shift_fn}(data->>%s, %s) OVER (ORDER BY row_number) AS val
                    FROM dataset_rows WHERE dataset_id = %s
                )
                UPDATE dataset_rows dr
                SET data = dr.data || jsonb_build_object(%s, s.val)
                FROM shifted s
                WHERE dr.dataset_id = %s AND dr.row_number = s.row_number
            """, (column_name, shift_amount, dataset_id,
                  new_column_name, dataset_id))
        conn.commit()

    new_columns = columns + [new_column_name]
    update_dataset_metadata_sql(dataset_id, new_columns)
    record_pipeline_step(
        dataset_id, "shift_column",
        {"column_name": column_name, "periods": periods, "new_column_name": new_column_name},
    )

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s AND data->>%s IS NOT NULL",
                (dataset_id, new_column_name),
            )
            non_null = cur.fetchone()[0]
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s",
                (dataset_id,),
            )
            total = cur.fetchone()[0]

    return {
        "columns": new_columns,
        "row_count": total,
        "new_column": new_column_name,
        "non_null": non_null,
        "null": total - non_null,
    }


# ---------------------------------------------------------------------------
# Column formula
# ---------------------------------------------------------------------------

# Safe tokens for column_formula expressions
_FORMULA_ALLOWED = re.compile(
    r'^[\w\s\+\-\*\/\(\)\.\,\%]+$'
)
_FORMULA_BLOCKED_WORDS = {"import", "exec", "eval", "compile", "__", "lambda", "open", "os", "sys"}
_FORMULA_BLOCKED_RE = re.compile(
    r'\b(' + '|'.join(re.escape(w) for w in _FORMULA_BLOCKED_WORDS if w != '__') + r')\b|(__)',
)


def column_formula(dataset_id: str, user_id: str, expression: str,
                   new_column_name: str) -> dict:
    """Create a new column from an arithmetic expression over existing columns via SQL."""
    # Safety: block anything that isn't basic arithmetic + column names
    if not _FORMULA_ALLOWED.match(expression):
        raise ValueError("Expression contains disallowed characters. "
                         "Only column names, numbers, and +, -, *, /, (, ), % are allowed.")
    lower = expression.lower()
    m = _FORMULA_BLOCKED_RE.search(lower)
    if m:
        raise ValueError(f"Expression contains disallowed keyword '{m.group()}'")

    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if new_column_name in columns:
        raise ValueError(f"Column '{new_column_name}' already exists")

    _safe_col(new_column_name)

    # Find column names referenced in the expression
    # Sort by length (longest first) so longer names get matched first
    referenced = sorted(
        [c for c in columns if re.search(r'(?<![a-zA-Z0-9_])' + re.escape(c) + r'(?![a-zA-Z0-9_])', expression)],
        key=len, reverse=True,
    )
    for c in referenced:
        _safe_col(c)

    # Build SQL expression: replace whole-word column names with JSONB accessors
    sql_expr = expression
    for col in referenced:
        sql_expr = re.sub(
            r'(?<![a-zA-Z0-9_])' + re.escape(col) + r'(?![a-zA-Z0-9_])',
            f"(data->>'{_q(col)}')::numeric",
            sql_expr,
        )

    # Validate via EXPLAIN dry-run
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    f"EXPLAIN SELECT ROUND(({sql_expr})::numeric, 4) "
                    f"FROM dataset_rows WHERE dataset_id = %s LIMIT 1",
                    (dataset_id,),
                )
            except Exception as e:
                conn.rollback()
                raise ValueError(f"Invalid expression: {e}")

            # Execute the actual update
            try:
                cur.execute(f"""
                    UPDATE dataset_rows
                    SET data = data || jsonb_build_object(%s, ROUND(({sql_expr})::numeric, 4)::text)
                    WHERE dataset_id = %s
                """, (new_column_name, dataset_id))
            except Exception as e:
                conn.rollback()
                raise ValueError(f"Expression evaluation failed: {e}")
        conn.commit()

    new_columns = columns + [new_column_name]
    update_dataset_metadata_sql(dataset_id, new_columns)
    record_pipeline_step(
        dataset_id, "column_formula",
        {"expression": expression, "new_column_name": new_column_name},
    )

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s AND data->>%s IS NOT NULL",
                (dataset_id, new_column_name),
            )
            non_null = cur.fetchone()[0]
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s",
                (dataset_id,),
            )
            total = cur.fetchone()[0]

    return {
        "columns": new_columns,
        "row_count": total,
        "new_column": new_column_name,
        "non_null": non_null,
        "null": total - non_null,
    }


# ---------------------------------------------------------------------------
# Format values (string template tool)
# ---------------------------------------------------------------------------

_FORMAT_VALID_MODIFIERS = {"upper", "lower", "trim", "left", "right", "slice"}


def _parse_format_modifier(mod_str: str) -> dict:
    """Parse a single modifier like 'upper', 'slice:0:10', 'left:5'."""
    parts = mod_str.split(":")
    name = parts[0].strip().lower()

    if name not in _FORMAT_VALID_MODIFIERS:
        raise ValueError(
            f"Unknown modifier '{name}'. "
            f"Supported: {', '.join(sorted(_FORMAT_VALID_MODIFIERS))}"
        )

    if name in ("upper", "lower", "trim"):
        if len(parts) > 1:
            raise ValueError(f"Modifier '{name}' does not take arguments")
        return {"name": name}

    if name == "left":
        if len(parts) != 2 or not parts[1].strip().isdigit():
            raise ValueError("'left' modifier requires a positive integer: left:N")
        n = int(parts[1].strip())
        if n <= 0:
            raise ValueError("'left' modifier requires a positive integer")
        return {"name": "left", "n": n}

    if name == "right":
        if len(parts) != 2 or not parts[1].strip().isdigit():
            raise ValueError("'right' modifier requires a positive integer: right:N")
        n = int(parts[1].strip())
        if n <= 0:
            raise ValueError("'right' modifier requires a positive integer")
        return {"name": "right", "n": n}

    # slice:start:end — both optional, 0-indexed like Python
    if name == "slice":
        if len(parts) < 2 or len(parts) > 3:
            raise ValueError(
                "'slice' modifier format: slice:start:end, slice:start:, or slice::end"
            )
        start_str = parts[1].strip() if len(parts) > 1 else ""
        end_str = parts[2].strip() if len(parts) > 2 else ""

        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else None

        if start < 0:
            raise ValueError("Negative slice indices are not supported")
        if end is not None and end < 0:
            raise ValueError("Negative slice indices are not supported")
        if end is not None and end <= start:
            raise ValueError(
                f"Slice end ({end}) must be greater than start ({start})"
            )
        return {"name": "slice", "start": start, "end": end}

    raise ValueError(f"Unknown modifier: {name}")


def _parse_format_template(template: str, valid_columns: list[str]) -> list[dict]:
    """Parse a format template into a list of literal and column-reference parts.

    Syntax:
      {column_name}              — insert column value
      {column_name|mod1|mod2}    — apply modifiers (upper, lower, trim, left:N,
                                   right:N, slice:start:end)
      {{  / }}                   — literal brace
      everything else            — literal text

    Returns list of:
      {"type": "literal", "value": "..."}
      {"type": "column", "name": "...", "modifiers": [...]}
    """
    if not template or not template.strip():
        raise ValueError("Template cannot be empty")

    # Escape literal braces with placeholders
    _PH_OPEN = "\x00\x01"
    _PH_CLOSE = "\x00\x02"
    work = template.replace("{{", _PH_OPEN).replace("}}", _PH_CLOSE)

    parts: list[dict] = []
    last_end = 0
    has_column = False

    for m in re.finditer(r'\{([^}]*)\}', work):
        # Literal text before this match
        if m.start() > last_end:
            lit = work[last_end:m.start()]
            if '{' in lit or '}' in lit:
                raise ValueError("Unmatched brace in template")
            lit = lit.replace(_PH_OPEN, "{").replace(_PH_CLOSE, "}")
            if lit:
                parts.append({"type": "literal", "value": lit})

        inner = m.group(1).strip()
        if not inner:
            raise ValueError("Empty column reference '{}' in template")

        segments = inner.split("|")
        col_name = segments[0].strip()
        if not col_name:
            raise ValueError("Empty column name in template reference")
        if col_name.startswith('"') or col_name.startswith("'"):
            raise ValueError(
                "Template appears to contain JSON — column names must not be "
                "quoted. Use {column_name|modifier} syntax, e.g. "
                '"{Date|slice:6:10}" not {"Date|slice": 6}.'
            )
        if col_name not in valid_columns:
            raise ValueError(
                f"Column '{col_name}' not found. "
                f"Available: {valid_columns}"
            )
        _safe_col(col_name)

        modifiers = []
        for mod_str in segments[1:]:
            mod_str = mod_str.strip()
            if mod_str:
                modifiers.append(_parse_format_modifier(mod_str))

        parts.append({"type": "column", "name": col_name, "modifiers": modifiers})
        has_column = True
        last_end = m.end()

    # Trailing literal
    if last_end < len(work):
        tail = work[last_end:]
        if '{' in tail or '}' in tail:
            raise ValueError("Unmatched brace in template")
        tail = tail.replace(_PH_OPEN, "{").replace(_PH_CLOSE, "}")
        if tail:
            parts.append({"type": "literal", "value": tail})

    if not has_column:
        raise ValueError(
            "Template must reference at least one column using {column_name}"
        )

    return parts


def _apply_format_modifier(sql_expr: str, mod: dict) -> str:
    """Wrap a SQL expression with a modifier function."""
    name = mod["name"]
    if name == "upper":
        return f"upper({sql_expr})"
    if name == "lower":
        return f"lower({sql_expr})"
    if name == "trim":
        return f"trim({sql_expr})"
    if name == "left":
        return f"left({sql_expr}, {mod['n']})"
    if name == "right":
        return f"right({sql_expr}, {mod['n']})"
    if name == "slice":
        pg_from = mod["start"] + 1  # Postgres is 1-indexed
        end = mod.get("end")
        if end is not None:
            pg_for = end - mod["start"]
            return f"substring({sql_expr} FROM {pg_from} FOR {pg_for})"
        return f"substring({sql_expr} FROM {pg_from})"
    raise ValueError(f"Unknown modifier: {name}")


def _build_format_sql(parts: list[dict]) -> str:
    """Compile parsed template parts into a Postgres SQL expression.

    Uses ``||`` for concatenation so NULL values propagate correctly
    (if any referenced column is NULL the result is NULL).
    """
    sql_parts: list[str] = []
    for part in parts:
        if part["type"] == "literal":
            escaped = part["value"].replace("'", "''")
            sql_parts.append(f"'{escaped}'")
        elif part["type"] == "column":
            col = part["name"]
            expr = f"(data->>'{_q(col)}')"
            for mod in part["modifiers"]:
                expr = _apply_format_modifier(expr, mod)
            sql_parts.append(expr)

    if len(sql_parts) == 1:
        return sql_parts[0]
    return " || ".join(sql_parts)


def _validate_structured_parts(parts: list[dict], columns: list[str]) -> list[dict]:
    """Validate and normalize the structured parts list from the agent tool.

    Each part is either:
      {"text": "literal string"}
      {"column": "name"}                            — insert value
      {"column": "name", "upper": true}             — uppercase
      {"column": "name", "lower": true}             — lowercase
      {"column": "name", "trim": true}              — trim whitespace
      {"column": "name", "left": N}                 — first N chars
      {"column": "name", "right": N}                — last N chars
      {"column": "name", "slice": [start, end]}     — substring (0-indexed)

    Returns internal format compatible with _build_format_sql().
    """
    if not parts:
        raise ValueError("parts list cannot be empty")

    has_column = False
    parsed: list[dict] = []

    for i, part in enumerate(parts):
        if not isinstance(part, dict):
            raise ValueError(f"Part {i} must be an object, got {type(part).__name__}")

        if "text" in part:
            val = str(part["text"])
            if val:
                parsed.append({"type": "literal", "value": val})
            continue

        if "column" not in part:
            raise ValueError(
                f"Part {i} must have either 'text' or 'column' key. "
                f"Got: {list(part.keys())}"
            )

        col_name = str(part["column"]).strip()
        if col_name not in columns:
            raise ValueError(
                f"Column '{col_name}' not found. Available: {columns}"
            )
        _safe_col(col_name)
        has_column = True

        modifiers: list[dict] = []
        if part.get("upper"):
            modifiers.append({"name": "upper"})
        if part.get("lower"):
            modifiers.append({"name": "lower"})
        if part.get("trim"):
            modifiers.append({"name": "trim"})
        if "left" in part and part["left"] is not True:
            n = int(part["left"])
            if n <= 0:
                raise ValueError("'left' must be a positive integer")
            modifiers.append({"name": "left", "n": n})
        if "right" in part and part["right"] is not True:
            n = int(part["right"])
            if n <= 0:
                raise ValueError("'right' must be a positive integer")
            modifiers.append({"name": "right", "n": n})
        if "slice" in part:
            sl = part["slice"]
            if not isinstance(sl, (list, tuple)) or len(sl) != 2:
                raise ValueError(
                    f"'slice' must be [start, end] (0-indexed). Got: {sl}"
                )
            start, end = int(sl[0]), int(sl[1])
            if start < 0 or end < 0:
                raise ValueError("Negative slice indices are not supported")
            if end <= start:
                raise ValueError(
                    f"Slice end ({end}) must be greater than start ({start})"
                )
            modifiers.append({"name": "slice", "start": start, "end": end})

        parsed.append({"type": "column", "name": col_name, "modifiers": modifiers})

    if not has_column:
        raise ValueError("parts must include at least one column reference")

    return parsed


def _parts_to_template(parts: list[dict]) -> str:
    """Convert structured parts back to a template string for pipeline storage."""
    result: list[str] = []
    for part in parts:
        if "text" in part:
            # Escape braces in literal text
            result.append(str(part["text"]).replace("{", "{{").replace("}", "}}"))
            continue
        col = part["column"]
        mods: list[str] = []
        if part.get("upper"):
            mods.append("upper")
        if part.get("lower"):
            mods.append("lower")
        if part.get("trim"):
            mods.append("trim")
        if "left" in part and part["left"] is not True:
            mods.append(f"left:{part['left']}")
        if "right" in part and part["right"] is not True:
            mods.append(f"right:{part['right']}")
        if "slice" in part:
            sl = part["slice"]
            mods.append(f"slice:{sl[0]}:{sl[1]}")
        if mods:
            result.append("{" + col + "|" + "|".join(mods) + "}")
        else:
            result.append("{" + col + "}")
    return "".join(result)


def format_values(dataset_id: str, user_id: str, template: str,
                  new_column_name: str,
                  parts: list[dict] | None = None) -> dict:
    """Create a new column by formatting/combining values from existing columns.

    Can be called two ways:
      1. **Structured** (preferred for agent): pass ``parts`` list
      2. **Template string** (used for pipeline replay): pass ``template``

    When ``parts`` is provided, ``template`` is generated automatically for
    pipeline storage.
    """
    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if new_column_name in columns:
        raise ValueError(f"Column '{new_column_name}' already exists")
    _safe_col(new_column_name)

    # Parse either structured parts or template string
    if parts is not None:
        parsed = _validate_structured_parts(parts, columns)
        template = _parts_to_template(parts)
    else:
        parsed = _parse_format_template(template, columns)

    # Build SQL expression
    sql_expr = _build_format_sql(parsed)

    # Validate via EXPLAIN dry-run, then execute
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(
                    f"EXPLAIN SELECT {sql_expr} "
                    f"FROM dataset_rows WHERE dataset_id = %s LIMIT 1",
                    (dataset_id,),
                )
            except Exception as e:
                conn.rollback()
                raise ValueError(f"Format expression produced invalid SQL: {e}")

            try:
                cur.execute(f"""
                    UPDATE dataset_rows
                    SET data = data || jsonb_build_object(%s, {sql_expr})
                    WHERE dataset_id = %s
                """, (new_column_name, dataset_id))
            except Exception as e:
                conn.rollback()
                raise ValueError(f"Format evaluation failed: {e}")
        conn.commit()

    new_columns = columns + [new_column_name]
    update_dataset_metadata_sql(dataset_id, new_columns)
    record_pipeline_step(
        dataset_id, "format_values",
        {"template": template, "new_column_name": new_column_name},
    )

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows "
                "WHERE dataset_id = %s AND data->>%s IS NOT NULL",
                (dataset_id, new_column_name),
            )
            non_null = cur.fetchone()[0]
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s",
                (dataset_id,),
            )
            total = cur.fetchone()[0]

    return {
        "columns": new_columns,
        "row_count": total,
        "new_column": new_column_name,
        "non_null": non_null,
        "null": total - non_null,
    }


# ---------------------------------------------------------------------------
# Join datasets
# ---------------------------------------------------------------------------

_JOIN_TYPES = {"inner", "left"}


def join_datasets(
    left_dataset_id: str,
    right_dataset_id: str,
    user_id: str,
    left_column: str,
    right_column: str,
    join_type: str = "inner",
    new_name: str | None = None,
    session_id: str | None = None,
) -> dict:
    """Join two datasets on a key column. Creates a new dataset with the
    merged rows and — when *session_id* is provided — replaces the two source
    datasets in the session with the joined result.

    Supported join types: inner, left.

    Column-conflict handling:
    * The right join-key column is dropped (redundant with the left key).
    * Any remaining column name that appears in both datasets is suffixed
      with ``_2`` (``_3``, etc.) on the right side.
    """
    if join_type not in _JOIN_TYPES:
        raise ValueError(
            f"Unsupported join type '{join_type}'. Supported: {', '.join(sorted(_JOIN_TYPES))}"
        )

    # ── validate both datasets ──
    left_ds = verify_dataset_ownership(left_dataset_id, user_id)
    right_ds = verify_dataset_ownership(right_dataset_id, user_id)

    left_cols: list[str] = left_ds["columns"]
    right_cols: list[str] = right_ds["columns"]

    if left_column not in left_cols:
        raise ValueError(
            f"Column '{left_column}' not found in left dataset. "
            f"Available: {left_cols}"
        )
    if right_column not in right_cols:
        raise ValueError(
            f"Column '{right_column}' not found in right dataset. "
            f"Available: {right_cols}"
        )
    _safe_col(left_column)
    _safe_col(right_column)

    # ── resolve output columns & conflicts ──
    right_output_cols = [c for c in right_cols if c != right_column]

    conflict_map: dict[str, str] = {}  # right_col -> renamed_col
    left_col_set = set(left_cols)
    used_names = set(left_cols)
    for rc in right_output_cols:
        if rc in left_col_set:
            renamed = f"{rc}_2"
            suffix = 2
            while renamed in used_names or renamed in conflict_map.values():
                suffix += 1
                renamed = f"{rc}_{suffix}"
            conflict_map[rc] = renamed
            used_names.add(renamed)

    output_cols: list[str] = list(left_cols)
    for rc in right_output_cols:
        output_cols.append(conflict_map.get(rc, rc))

    # ── build jsonb_build_object expression ──
    pairs: list[str] = []
    for col in left_cols:
        _safe_col(col)
        pairs.append(f"'{_q(col)}', a.data->'{_q(col)}'")
    for col in right_output_cols:
        _safe_col(col)
        out_name = conflict_map.get(col, col)
        _safe_col(out_name)
        pairs.append(f"'{_q(out_name)}', b.data->'{_q(col)}'")

    jsonb_expr = "jsonb_build_object(\n" + ",\n".join(f"    {p}" for p in pairs) + "\n)"

    join_sql = "INNER JOIN" if join_type == "inner" else "LEFT JOIN"

    # ── create new dataset record ──
    if not new_name:
        left_name = left_ds.get("filename", "left")
        right_name = right_ds.get("filename", "right")
        new_name = f"{left_name} + {right_name}"

    new_ds = (
        supabase_admin.table("datasets")
        .insert({
            "user_id": user_id,
            "filename": new_name,
            "storage_path": "joined",
            "columns": output_cols,
            "original_columns": output_cols,
            "row_count": 0,
            "file_size_bytes": 0,
            "col_avg_chars": {},
        })
        .execute()
    )
    new_dataset_id = new_ds.data[0]["id"]

    # ── execute join & write rows ──
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                WITH left_data AS (
                    SELECT row_number, data
                    FROM dataset_rows WHERE dataset_id = %s
                    ORDER BY row_number
                ),
                right_data AS (
                    SELECT row_number, data
                    FROM dataset_rows WHERE dataset_id = %s
                    ORDER BY row_number
                )
                INSERT INTO dataset_rows (dataset_id, row_number, data)
                SELECT
                    %s,
                    ROW_NUMBER() OVER (
                        ORDER BY a.row_number, b.row_number NULLS LAST
                    ),
                    {jsonb_expr}
                FROM left_data a
                {join_sql} right_data b
                    ON (a.data->>'{_q(left_column)}') = (b.data->>'{_q(right_column)}')
            """, (left_dataset_id, right_dataset_id, new_dataset_id))

            row_count = cur.rowcount

            # copy to original rows
            cur.execute("""
                INSERT INTO dataset_rows_original (dataset_id, row_number, data)
                SELECT dataset_id, row_number, data
                FROM dataset_rows
                WHERE dataset_id = %s
            """, (new_dataset_id,))
        conn.commit()

    # ── update metadata ──
    update_dataset_metadata_sql(new_dataset_id, output_cols)

    # ── update session: swap sources for joined dataset ──
    if session_id:
        supabase_admin.table("session_datasets") \
            .delete() \
            .eq("session_id", session_id) \
            .eq("dataset_id", left_dataset_id) \
            .execute()
        supabase_admin.table("session_datasets") \
            .delete() \
            .eq("session_id", session_id) \
            .eq("dataset_id", right_dataset_id) \
            .execute()

        existing = (
            supabase_admin.table("session_datasets")
            .select("display_order")
            .eq("session_id", session_id)
            .order("display_order", desc=True)
            .limit(1)
            .execute()
        )
        next_order = (existing.data[0]["display_order"] + 1) if existing.data else 0

        supabase_admin.table("session_datasets").insert({
            "session_id": session_id,
            "dataset_id": new_dataset_id,
            "display_order": next_order,
        }).execute()

    return {
        "dataset_id": new_dataset_id,
        "name": new_name,
        "columns": output_cols,
        "row_count": row_count,
        "conflict_renames": conflict_map,
    }


_CASE_WHEN_OPS = {"=", "!=", ">", "<", ">=", "<="}


def case_when(dataset_id: str, user_id: str, column_name: str,
              operator: str, compare_value: str, then_value: str,
              else_value: str, new_column_name: str) -> dict:
    """Create a conditional column: if column op value then X else Y.

    compare_value can be a literal number/string or another column name.
    then_value / else_value can also be literal values or column names.
    """
    if operator not in _CASE_WHEN_OPS:
        raise ValueError(
            f"Unsupported operator '{operator}'. "
            f"Use one of: {', '.join(sorted(_CASE_WHEN_OPS))}"
        )

    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if column_name not in columns:
        raise ValueError(f"Column '{column_name}' does not exist")
    if new_column_name in columns:
        raise ValueError(f"Column '{new_column_name}' already exists")

    _safe_col(column_name)
    _safe_col(new_column_name)

    def _val_sql(val: str) -> tuple[str, list]:
        """Return (sql_fragment, params) for a value — column ref or literal."""
        if val in columns:
            _safe_col(val)
            return f"(data->>'{_q(val)}')", []
        return "%s", [val]

    # Build the left side (always a column)
    left = f"(data->>'{_q(column_name)}')"

    # Build the comparison value
    cmp_sql, cmp_params = _val_sql(compare_value)

    # Try numeric comparison when possible
    left_cast = (
        f"CASE WHEN {left} ~ '^-?[0-9]+(\\.[0-9]+)?$' "
        f"AND {cmp_sql} ~ '^-?[0-9]+(\\.[0-9]+)?$' "
        f"THEN ({left})::numeric {operator} ({cmp_sql})::numeric "
        f"ELSE {left} {operator} {cmp_sql} END"
    )

    # Build then/else values
    then_sql, then_params = _val_sql(then_value)
    else_sql, else_params = _val_sql(else_value)

    all_params = [new_column_name] + cmp_params * 3 + then_params + else_params + [dataset_id]

    sql = f"""
        UPDATE dataset_rows
        SET data = data || jsonb_build_object(
            %s,
            CASE WHEN {left_cast} THEN {then_sql} ELSE {else_sql} END
        )
        WHERE dataset_id = %s
    """

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            try:
                cur.execute(sql, all_params)
            except Exception as e:
                conn.rollback()
                raise ValueError(f"Case expression failed: {e}")
        conn.commit()

    new_columns = columns + [new_column_name]
    update_dataset_metadata_sql(dataset_id, new_columns)
    record_pipeline_step(dataset_id, "case_when", {
        "column_name": column_name,
        "operator": operator,
        "compare_value": compare_value,
        "then_value": then_value,
        "else_value": else_value,
        "new_column_name": new_column_name,
    })

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s AND data->>%s IS NOT NULL",
                (dataset_id, new_column_name),
            )
            non_null = cur.fetchone()[0]
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s",
                (dataset_id,),
            )
            total = cur.fetchone()[0]

    return {
        "columns": new_columns,
        "row_count": total,
        "new_column": new_column_name,
        "non_null": non_null,
        "null": total - non_null,
    }


# ---------------------------------------------------------------------------
# Read-only helpers
# ---------------------------------------------------------------------------


def sample_dataset_rows(dataset_id: str, user_id: str, n: int = 5) -> dict:
    """Return a sample of rows from the dataset for agent inspection via direct Postgres."""
    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    row_count = ds["row_count"]

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT data FROM dataset_rows WHERE dataset_id = %s ORDER BY row_number LIMIT %s",
                (dataset_id, n),
            )
            sample = [r[0] for r in cur.fetchall()]

    return {"columns": columns, "row_count": row_count, "sample": sample}


# ---------------------------------------------------------------------------
# Analytics — all via SQL
# ---------------------------------------------------------------------------


def column_statistics(dataset_id: str, user_id: str, column_name: str) -> dict:
    """Compute summary statistics for a single column via SQL."""
    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if column_name not in columns:
        raise ValueError(f"Column '{column_name}' does not exist")

    _safe_col(column_name)

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            # Total rows
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows WHERE dataset_id = %s",
                (dataset_id,),
            )
            total = cur.fetchone()[0]

            # Non-null and empty counts
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows "
                "WHERE dataset_id = %s AND data->>%s IS NOT NULL",
                (dataset_id, column_name),
            )
            non_null = cur.fetchone()[0]

            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows "
                "WHERE dataset_id = %s AND (data->>%s IS NULL OR TRIM(data->>%s) = '')",
                (dataset_id, column_name, column_name),
            )
            empty = cur.fetchone()[0]

            # Unique count
            cur.execute(
                "SELECT COUNT(DISTINCT data->>%s) FROM dataset_rows "
                "WHERE dataset_id = %s AND data->>%s IS NOT NULL",
                (column_name, dataset_id, column_name),
            )
            unique = cur.fetchone()[0]

            # Top 5 most frequent values
            cur.execute(
                "SELECT data->>%s AS val, COUNT(*) AS cnt FROM dataset_rows "
                "WHERE dataset_id = %s AND data->>%s IS NOT NULL "
                "GROUP BY val ORDER BY cnt DESC LIMIT 5",
                (column_name, dataset_id, column_name),
            )
            top_values = {row[0]: row[1] for row in cur.fetchall()}

            stats: dict = {
                "total": total,
                "non_null": non_null,
                "empty": empty,
                "unique": unique,
                "top_values": top_values,
            }

            # Numeric stats
            cur.execute(f"""
                SELECT COUNT(*), MIN(v), MAX(v), ROUND(AVG(v)::numeric, 4),
                       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v)
                FROM (
                    SELECT (data->>%s)::numeric AS v
                    FROM dataset_rows
                    WHERE dataset_id = %s AND data->>%s ~ '{_NUMERIC_RE}'
                ) sub
            """, (column_name, dataset_id, column_name))
            row = cur.fetchone()
            if row[0] and row[0] > 0:
                stats["min"] = float(row[1])
                stats["max"] = float(row[2])
                stats["mean"] = float(row[3])
                stats["median"] = float(row[4])

            # String length stats
            cur.execute(
                "SELECT ROUND(AVG(LENGTH(data->>%s))::numeric, 1), "
                "       MIN(LENGTH(data->>%s)), MAX(LENGTH(data->>%s)) "
                "FROM dataset_rows "
                "WHERE dataset_id = %s AND data->>%s IS NOT NULL",
                (column_name, column_name, column_name, dataset_id, column_name),
            )
            srow = cur.fetchone()
            if srow[0] is not None:
                stats["avg_length"] = float(srow[0])
                stats["min_length"] = int(srow[1])
                stats["max_length"] = int(srow[2])

    return stats


def column_distribution(dataset_id: str, user_id: str, column_name: str) -> dict:
    """Compute a distribution summary for a column via SQL."""
    ds = verify_dataset_ownership(dataset_id, user_id)
    columns = ds["columns"]
    if column_name not in columns:
        raise ValueError(f"Column '{column_name}' does not exist")

    _safe_col(column_name)

    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            # Total non-null
            cur.execute(
                "SELECT COUNT(*) FROM dataset_rows "
                "WHERE dataset_id = %s AND data->>%s IS NOT NULL",
                (dataset_id, column_name),
            )
            total = cur.fetchone()[0]
            if total == 0:
                return {"type": "empty", "total": 0}

            # Unique count
            cur.execute(
                "SELECT COUNT(DISTINCT data->>%s) FROM dataset_rows "
                "WHERE dataset_id = %s AND data->>%s IS NOT NULL",
                (column_name, dataset_id, column_name),
            )
            unique = cur.fetchone()[0]

            # --- Branch 1: Low cardinality (<=50 unique) ---
            if unique <= 50:
                cur.execute(
                    "SELECT data->>%s AS val, COUNT(*) AS cnt FROM dataset_rows "
                    "WHERE dataset_id = %s AND data->>%s IS NOT NULL "
                    "GROUP BY val ORDER BY cnt DESC",
                    (column_name, dataset_id, column_name),
                )
                values = [
                    {"value": row[0], "count": int(row[1]),
                     "pct": round(row[1] / total * 100, 1)}
                    for row in cur.fetchall()
                ]
                return {"type": "value_counts", "total": total, "values": values}

            # Check how many values are numeric
            cur.execute(f"""
                SELECT COUNT(*) FROM dataset_rows
                WHERE dataset_id = %s AND data->>%s ~ '{_NUMERIC_RE}'
            """, (dataset_id, column_name))
            numeric_count = cur.fetchone()[0]

            # --- Branch 2: Numeric (>80% numeric) ---
            if numeric_count / total > 0.8:
                cur.execute(f"""
                    SELECT MIN(v), MAX(v), ROUND(AVG(v)::numeric, 4),
                           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY v),
                           ROUND(STDDEV(v)::numeric, 4), COUNT(*)
                    FROM (
                        SELECT (data->>%s)::numeric AS v
                        FROM dataset_rows
                        WHERE dataset_id = %s AND data->>%s ~ '{_NUMERIC_RE}'
                    ) sub
                """, (column_name, dataset_id, column_name))
                srow = cur.fetchone()
                vmin, vmax, vmean, vmedian, vstd, vcount = (
                    float(srow[0]), float(srow[1]), float(srow[2]),
                    float(srow[3]), float(srow[4]) if srow[4] else 0.0, int(srow[5])
                )

                # Compute histogram bins with WIDTH_BUCKET
                if vmin == vmax:
                    bins = [{"range": f"{vmin:.4g}-{vmax:.4g}", "count": vcount}]
                else:
                    cur.execute(f"""
                        SELECT WIDTH_BUCKET(v, %s, %s + 0.0001, 10) AS bucket,
                               COUNT(*) AS cnt
                        FROM (
                            SELECT (data->>%s)::numeric AS v
                            FROM dataset_rows
                            WHERE dataset_id = %s AND data->>%s ~ '{_NUMERIC_RE}'
                        ) sub
                        GROUP BY bucket ORDER BY bucket
                    """, (vmin, vmax, column_name, dataset_id, column_name))
                    bin_width = (vmax - vmin) / 10
                    bins = []
                    for brow in cur.fetchall():
                        bucket = brow[0]
                        lo = vmin + (bucket - 1) * bin_width
                        hi = lo + bin_width
                        bins.append({"range": f"{lo:.4g}-{hi:.4g}", "count": int(brow[1])})

                return {
                    "type": "histogram",
                    "subtype": "numeric",
                    "total": vcount,
                    "min": vmin,
                    "max": vmax,
                    "mean": vmean,
                    "median": vmedian,
                    "std": vstd,
                    "bins": bins,
                }

            # --- Branch 3: Date detection ---
            # Try casting to date — if >80% succeed, it's a date column
            cur.execute(
                r"SELECT COUNT(*) FROM dataset_rows"
                r" WHERE dataset_id = %s AND data->>%s IS NOT NULL"
                r"   AND data->>%s ~ '^\d{4}[-/]\d{1,2}[-/]\d{1,2}'",
                (dataset_id, column_name, column_name),
            )
            date_count = cur.fetchone()[0]

            if date_count / total > 0.8:
                try:
                    cur.execute(
                        r"SELECT MIN(d), MAX(d) FROM ("
                        r"  SELECT (data->>%s)::date AS d"
                        r"  FROM dataset_rows"
                        r"  WHERE dataset_id = %s AND data->>%s ~ '^\d{4}[-/]\d{1,2}[-/]\d{1,2}'"
                        r") sub",
                        (column_name, dataset_id, column_name),
                    )
                    drow = cur.fetchone()
                    min_date, max_date = drow[0], drow[1]
                    date_range = (max_date - min_date).days

                    if date_range > 365:
                        trunc = "month"
                    elif date_range > 30:
                        trunc = "week"
                    else:
                        trunc = "day"

                    cur.execute(
                        r"SELECT DATE_TRUNC(%s, d) AS period, COUNT(*) AS cnt"
                        r" FROM ("
                        r"  SELECT (data->>%s)::date AS d"
                        r"  FROM dataset_rows"
                        r"  WHERE dataset_id = %s AND data->>%s ~ '^\d{4}[-/]\d{1,2}[-/]\d{1,2}'"
                        r") sub"
                        r" GROUP BY period ORDER BY period",
                        (trunc, column_name, dataset_id, column_name),
                    )
                    bin_list = [
                        {"range": str(r[0].date() if hasattr(r[0], 'date') else r[0]),
                         "count": int(r[1])}
                        for r in cur.fetchall()
                    ]

                    return {
                        "type": "histogram",
                        "subtype": "date",
                        "total": date_count,
                        "min_date": str(min_date),
                        "max_date": str(max_date),
                        "period": trunc,
                        "bins": bin_list,
                    }
                except Exception:
                    conn.rollback()
                    # Fall through to text length

            # --- Branch 4: Text length fallback ---
            cur.execute("""
                SELECT MIN(LENGTH(data->>%s)), MAX(LENGTH(data->>%s)),
                       ROUND(AVG(LENGTH(data->>%s))::numeric, 1)
                FROM dataset_rows
                WHERE dataset_id = %s AND data->>%s IS NOT NULL
            """, (column_name, column_name, column_name, dataset_id, column_name))
            lrow = cur.fetchone()
            lmin, lmax, lavg = int(lrow[0]), int(lrow[1]), float(lrow[2])

            if lmin == lmax:
                bins = [{"range": f"{lmin}-{lmax} chars", "count": total}]
            else:
                cur.execute("""
                    SELECT WIDTH_BUCKET(LENGTH(data->>%s), %s, %s + 1, 10) AS bucket,
                           COUNT(*) AS cnt
                    FROM dataset_rows
                    WHERE dataset_id = %s AND data->>%s IS NOT NULL
                    GROUP BY bucket ORDER BY bucket
                """, (column_name, lmin, lmax, dataset_id, column_name))
                bin_width = (lmax - lmin) / 10
                bins = []
                for brow in cur.fetchall():
                    bucket = brow[0]
                    lo = int(lmin + (bucket - 1) * bin_width)
                    hi = int(lo + bin_width)
                    bins.append({"range": f"{lo}-{hi} chars", "count": int(brow[1])})

            return {
                "type": "histogram",
                "subtype": "text_length",
                "total": total,
                "avg_length": lavg,
                "bins": bins,
            }


# ---------------------------------------------------------------------------
# Pipeline step recording & replay
# ---------------------------------------------------------------------------


def record_pipeline_step(dataset_id: str, operation: str, params: dict,
                         result_summary: str | None = None,
                         column_data: list | None = None):
    """Record a pipeline step. Automatically assigns the next step_number."""
    existing = (
        supabase_admin.table("pipeline_steps")
        .select("step_number")
        .eq("dataset_id", dataset_id)
        .order("step_number", desc=True)
        .limit(1)
        .execute()
    )
    next_step = (existing.data[0]["step_number"] + 1) if existing.data else 1

    row = {
        "dataset_id": dataset_id,
        "step_number": next_step,
        "operation": operation,
        "params": params,
    }
    if result_summary is not None:
        row["result_summary"] = result_summary
    if column_data is not None:
        row["column_data"] = column_data

    supabase_admin.table("pipeline_steps").insert(row).execute()


def get_pipeline_steps(dataset_id: str, user_id: str) -> list[dict]:
    """Return all pipeline steps for a dataset, ordered by step_number."""
    verify_dataset_ownership(dataset_id, user_id)

    result = (
        supabase_admin.table("pipeline_steps")
        .select("id, step_number, operation, params, result_summary, created_at")
        .eq("dataset_id", dataset_id)
        .order("step_number")
        .execute()
    )
    steps = result.data
    for s in steps:
        s["sql_preview"] = generate_sql_preview(s["operation"], s["params"])
    return steps


def _restore_from_original(dataset_id: str):
    """Restore dataset_rows from dataset_rows_original."""
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM dataset_rows WHERE dataset_id = %s", (dataset_id,))
            cur.execute(
                "INSERT INTO dataset_rows (dataset_id, row_number, data) "
                "SELECT dataset_id, row_number, data FROM dataset_rows_original "
                "WHERE dataset_id = %s",
                (dataset_id,),
            )
        conn.commit()


def _apply_step_sql(dataset_id: str, step: dict, columns: list[str]) -> list[str]:
    """Apply a single pipeline step as SQL. Returns updated column list."""
    op = step["operation"]
    p = step["params"]

    if op == "rename_column":
        old_name, new_name = p["old_name"], p["new_name"]
        _safe_col(old_name)
        _safe_col(new_name)
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE dataset_rows "
                    "SET data = (data - %s) || jsonb_build_object(%s, data->%s) "
                    "WHERE dataset_id = %s AND data ? %s",
                    (old_name, new_name, old_name, dataset_id, old_name),
                )
            conn.commit()
        return [new_name if c == old_name else c for c in columns]

    elif op == "delete_column":
        col = p["column_name"]
        _safe_col(col)
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE dataset_rows SET data = data - %s WHERE dataset_id = %s",
                    (col, dataset_id),
                )
            conn.commit()
        return [c for c in columns if c != col]

    elif op == "duplicate_column":
        col = p["column_name"]
        new_col = p["new_column_name"]
        _safe_col(col)
        _safe_col(new_col)
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE dataset_rows "
                    "SET data = data || jsonb_build_object(%s, data->%s) "
                    "WHERE dataset_id = %s",
                    (new_col, col, dataset_id),
                )
            conn.commit()
        return columns + [new_col]

    elif op == "find_replace":
        col = p["column_name"]
        _safe_col(col)
        fv, rv = p["find_value"], p["replace_value"]
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE dataset_rows "
                    "SET data = jsonb_set(data, ARRAY[%s], "
                    "    to_jsonb(REPLACE(COALESCE(data->>%s, ''), %s, %s))) "
                    "WHERE dataset_id = %s AND data->>%s LIKE %s",
                    (col, col, fv, rv, dataset_id, col, f"%{fv}%"),
                )
            conn.commit()
        return columns

    elif op == "filter_rows":
        col = p["column_name"]
        operator = p["operator"]
        value = p.get("value", "")
        condition, params = _build_filter_condition(col, operator, value)
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"DELETE FROM dataset_rows WHERE dataset_id = %s AND NOT ({condition})",
                    [dataset_id] + params,
                )
            conn.commit()
        return columns

    elif op == "sort_dataset":
        col = p["column_name"]
        direction = p.get("direction", "asc")
        sort_type = p.get("sort_type", "text")
        _safe_col(col)
        sql_dir = "ASC" if direction == "asc" else "DESC"
        nulls = "NULLS LAST" if direction == "asc" else "NULLS FIRST"
        if sort_type == "numeric":
            order_expr = (
                f"CASE WHEN data->>'{_q(col)}' ~ '^-?[0-9]+(\\.[0-9]+)?$' "
                f"THEN (data->>'{_q(col)}')::numeric ELSE NULL END {sql_dir} {nulls}"
            )
        elif sort_type == "date":
            order_expr = (
                f"CASE "
                f"WHEN data->>'{_q(col)}' ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}' "
                f"  THEN (data->>'{_q(col)}')::timestamp "
                f"WHEN data->>'{_q(col)}' ~ '^\\d{{1,2}}/\\d{{1,2}}/\\d{{4}}' "
                f"  THEN TO_TIMESTAMP(data->>'{_q(col)}', 'MM/DD/YYYY') "
                f"WHEN data->>'{_q(col)}' ~ '^[A-Za-z]{{3}} \\d{{1,2}}, \\d{{4}}' "
                f"  THEN TO_TIMESTAMP(data->>'{_q(col)}', 'Mon DD, YYYY') "
                f"WHEN data->>'{_q(col)}' ~ '^[A-Za-z]+ \\d{{1,2}}, \\d{{4}}' "
                f"  THEN TO_TIMESTAMP(data->>'{_q(col)}', 'FMMonth DD, YYYY') "
                f"ELSE NULL END {sql_dir} {nulls}"
            )
        else:
            order_expr = f"data->>'{_q(col)}' {sql_dir} {nulls}"
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"""
                    WITH sorted AS (
                        SELECT ctid,
                               ROW_NUMBER() OVER (ORDER BY {order_expr}, ctid) AS new_rn
                        FROM dataset_rows
                        WHERE dataset_id = %s
                    )
                    UPDATE dataset_rows dr
                    SET row_number = s.new_rn
                    FROM sorted s
                    WHERE dr.ctid = s.ctid
                """, (dataset_id,))
            conn.commit()
        return columns

    elif op == "window_aggregate":
        col = p["column_name"]
        new_col = p["new_column_name"]
        window = p["window"]
        aggregation = p["aggregation"]
        _safe_col(col)
        _safe_col(new_col)

        if aggregation == "median":
            import statistics
            with get_pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT row_number, data->>%s FROM dataset_rows "
                        "WHERE dataset_id = %s ORDER BY row_number",
                        (col, dataset_id),
                    )
                    rows_data = cur.fetchall()
            values = []
            row_numbers = []
            for rn, val in rows_data:
                row_numbers.append(rn)
                try:
                    values.append(float(val)) if val is not None else values.append(None)
                except (ValueError, TypeError):
                    values.append(None)
            updates = []
            for i in range(len(values)):
                if i < window - 1:
                    updates.append((row_numbers[i], None))
                    continue
                win_vals = [v for v in values[i - window + 1:i + 1] if v is not None]
                if len(win_vals) >= window:
                    updates.append((row_numbers[i], str(round(statistics.median(win_vals), 4))))
                else:
                    updates.append((row_numbers[i], None))
            with get_pg_conn() as conn:
                with conn.cursor() as cur:
                    for rn, val in updates:
                        if val is not None:
                            cur.execute(
                                "UPDATE dataset_rows SET data = data || jsonb_build_object(%s, %s) "
                                "WHERE dataset_id = %s AND row_number = %s",
                                (new_col, val, dataset_id, rn),
                            )
                        else:
                            cur.execute(
                                "UPDATE dataset_rows SET data = data || jsonb_build_object(%s, null) "
                                "WHERE dataset_id = %s AND row_number = %s",
                                (new_col, dataset_id, rn),
                            )
                conn.commit()
        else:
            sql_agg = _SQL_AGG_MAP[aggregation]
            with get_pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(f"""
                        WITH windowed AS (
                            SELECT row_number,
                                ROUND({sql_agg}(
                                    CASE WHEN data->>%s ~ '{_NUMERIC_RE}'
                                         THEN (data->>%s)::numeric ELSE NULL END
                                ) OVER (ORDER BY row_number ROWS BETWEEN %s PRECEDING AND CURRENT ROW), 4) AS val,
                                COUNT(
                                    CASE WHEN data->>%s ~ '{_NUMERIC_RE}'
                                         THEN 1 ELSE NULL END
                                ) OVER (ORDER BY row_number ROWS BETWEEN %s PRECEDING AND CURRENT ROW) AS window_count
                            FROM dataset_rows WHERE dataset_id = %s
                        )
                        UPDATE dataset_rows dr
                        SET data = dr.data || jsonb_build_object(%s,
                            CASE WHEN w.window_count >= %s THEN w.val::text ELSE NULL END)
                        FROM windowed w
                        WHERE dr.dataset_id = %s AND dr.row_number = w.row_number
                    """, (col, col, window - 1, col, window - 1, dataset_id,
                          new_col, window, dataset_id))
                conn.commit()
        return columns + [new_col]

    elif op == "shift_column":
        col = p["column_name"]
        periods = p["periods"]
        new_col = p["new_column_name"]
        _safe_col(col)
        _safe_col(new_col)
        shift_fn = "LAG" if periods > 0 else "LEAD"
        shift_amount = abs(periods)
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"""
                    WITH shifted AS (
                        SELECT row_number,
                               {shift_fn}(data->>%s, %s) OVER (ORDER BY row_number) AS val
                        FROM dataset_rows WHERE dataset_id = %s
                    )
                    UPDATE dataset_rows dr
                    SET data = dr.data || jsonb_build_object(%s, s.val)
                    FROM shifted s
                    WHERE dr.dataset_id = %s AND dr.row_number = s.row_number
                """, (col, shift_amount, dataset_id, new_col, dataset_id))
            conn.commit()
        return columns + [new_col]

    elif op == "column_formula":
        expr = p["expression"]
        new_col = p["new_column_name"]
        _safe_col(new_col)
        referenced = sorted(
            [c for c in columns if re.search(r'(?<![a-zA-Z0-9_])' + re.escape(c) + r'(?![a-zA-Z0-9_])', expr)],
            key=len, reverse=True,
        )
        for c in referenced:
            _safe_col(c)
        sql_expr = expr
        for c in referenced:
            sql_expr = re.sub(
                r'(?<![a-zA-Z0-9_])' + re.escape(c) + r'(?![a-zA-Z0-9_])',
                f"(data->>'{_q(c)}')::numeric",
                sql_expr,
            )
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(f"""
                        UPDATE dataset_rows
                        SET data = data || jsonb_build_object(%s, ROUND(({sql_expr})::numeric, 4)::text)
                        WHERE dataset_id = %s
                    """, (new_col, dataset_id))
                except Exception as e:
                    conn.rollback()
                    raise ValueError(f"Formula replay failed: {e}")
            conn.commit()
        return columns + [new_col]

    elif op == "case_when":
        col = p["column_name"]
        operator = p["operator"]
        compare_value = p["compare_value"]
        then_value = p["then_value"]
        else_value = p["else_value"]
        new_col = p["new_column_name"]
        _safe_col(col)
        _safe_col(new_col)

        def _val_sql_replay(val: str) -> str:
            if val in columns:
                _safe_col(val)
                return f"(data->>'{_q(val)}')"
            return f"'{val}'"

        left = f"(data->>'{_q(col)}')"
        cmp = _val_sql_replay(compare_value)
        condition = (
            f"CASE WHEN {left} ~ '^-?[0-9]+(\\.[0-9]+)?$' "
            f"AND {cmp} ~ '^-?[0-9]+(\\.[0-9]+)?$' "
            f"THEN ({left})::numeric {operator} ({cmp})::numeric "
            f"ELSE {left} {operator} {cmp} END"
        )
        then_sql = _val_sql_replay(then_value)
        else_sql = _val_sql_replay(else_value)

        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(f"""
                    UPDATE dataset_rows
                    SET data = data || jsonb_build_object(
                        %s,
                        CASE WHEN {condition} THEN {then_sql} ELSE {else_sql} END
                    )
                    WHERE dataset_id = %s
                """, (new_col, dataset_id))
            conn.commit()
        return columns + [new_col]

    elif op == "format_values":
        template = p["template"]
        new_col = p["new_column_name"]
        _safe_col(new_col)
        parts = _parse_format_template(template, columns)
        sql_expr = _build_format_sql(parts)
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                try:
                    cur.execute(f"""
                        UPDATE dataset_rows
                        SET data = data || jsonb_build_object(%s, {sql_expr})
                        WHERE dataset_id = %s
                    """, (new_col, dataset_id))
                except Exception as e:
                    conn.rollback()
                    raise ValueError(f"format_values replay failed: {e}")
            conn.commit()
        return columns + [new_col]

    elif op == "run_transform":
        column_data = step.get("column_data")
        new_col = p["new_column_name"]
        _safe_col(new_col)
        if column_data is not None:
            # Write stored column_data back via bulk update
            with get_pg_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT row_number FROM dataset_rows "
                        "WHERE dataset_id = %s ORDER BY row_number",
                        (dataset_id,),
                    )
                    row_numbers = [r[0] for r in cur.fetchall()]

                    for rn, val in zip(row_numbers, column_data):
                        cur.execute(
                            "UPDATE dataset_rows SET data = data || jsonb_build_object(%s, %s) "
                            "WHERE dataset_id = %s AND row_number = %s",
                            (new_col, val, dataset_id, rn),
                        )
                conn.commit()
        else:
            log.warning("run_transform step missing column_data, skipping")
        return columns + [new_col]

    else:
        log.warning(f"Unknown pipeline operation '{op}', skipping")
        return columns


def replay_pipeline(dataset_id: str, user_id: str):
    """Re-materialize dataset_rows by replaying all pipeline steps from original data."""
    _restore_from_original(dataset_id)

    # Get original columns
    ds = (
        supabase_admin.table("datasets")
        .select("original_columns")
        .eq("id", dataset_id)
        .single()
        .execute()
    )
    columns = list(ds.data["original_columns"]) if ds.data and ds.data.get("original_columns") else []

    # If no original_columns saved, fall back to current columns
    if not columns:
        ds2 = (
            supabase_admin.table("datasets")
            .select("columns")
            .eq("id", dataset_id)
            .single()
            .execute()
        )
        columns = ds2.data["columns"] if ds2.data else []

    # Fetch all remaining steps (including column_data for run_transform)
    steps = (
        supabase_admin.table("pipeline_steps")
        .select("operation, params, column_data")
        .eq("dataset_id", dataset_id)
        .order("step_number")
        .execute()
    ).data

    for step in steps:
        try:
            columns = _apply_step_sql(dataset_id, step, columns)
        except Exception as e:
            log.error(f"Replay failed at step {step['operation']}: {e}")
            raise ValueError(f"Pipeline replay failed at {step['operation']}: {e}")

    update_dataset_metadata_sql(dataset_id, columns)


def undo_last_step(dataset_id: str, user_id: str) -> dict:
    """Remove the last pipeline step and re-materialize from original data."""
    verify_dataset_ownership(dataset_id, user_id)

    last = (
        supabase_admin.table("pipeline_steps")
        .select("id, step_number, operation, params")
        .eq("dataset_id", dataset_id)
        .order("step_number", desc=True)
        .limit(1)
        .execute()
    )
    if not last.data:
        raise ValueError("No pipeline steps to undo")

    step = last.data[0]
    supabase_admin.table("pipeline_steps").delete().eq("id", step["id"]).execute()

    replay_pipeline(dataset_id, user_id)

    ds = (
        supabase_admin.table("datasets")
        .select("columns, row_count")
        .eq("id", dataset_id)
        .single()
        .execute()
    )

    return {
        "columns": ds.data["columns"],
        "row_count": ds.data["row_count"],
        "step_removed": {"operation": step["operation"], "params": step["params"]},
    }


def revert_to_step(dataset_id: str, user_id: str, step_number: int) -> dict:
    """Remove all pipeline steps after step_number and re-materialize."""
    verify_dataset_ownership(dataset_id, user_id)

    # Verify the target step exists
    target = (
        supabase_admin.table("pipeline_steps")
        .select("id")
        .eq("dataset_id", dataset_id)
        .eq("step_number", step_number)
        .execute()
    )
    if not target.data:
        raise ValueError(f"Step {step_number} does not exist")

    # Delete all steps after the target
    later = (
        supabase_admin.table("pipeline_steps")
        .select("id")
        .eq("dataset_id", dataset_id)
        .gt("step_number", step_number)
        .execute()
    )
    for s in (later.data or []):
        supabase_admin.table("pipeline_steps").delete().eq("id", s["id"]).execute()

    replay_pipeline(dataset_id, user_id)

    ds = (
        supabase_admin.table("datasets")
        .select("columns, row_count")
        .eq("id", dataset_id)
        .single()
        .execute()
    )

    return {
        "columns": ds.data["columns"],
        "row_count": ds.data["row_count"],
        "steps_remaining": step_number,
    }


def generate_sql_preview(operation: str, params: dict) -> str:
    """Generate a human-readable SQL preview for a pipeline step."""
    p = params

    if operation == "rename_column":
        return (
            f"UPDATE dataset_rows\n"
            f"SET data = (data - '{p['old_name']}') || "
            f"jsonb_build_object('{p['new_name']}', data->'{p['old_name']}')\n"
            f"WHERE data ? '{p['old_name']}'"
        )

    elif operation == "delete_column":
        col = p.get("column_name") or ", ".join(p.get("column_names", []))
        names = p.get("column_names", [p.get("column_name")])
        removal = " - ".join(f"'{n}'" for n in names)
        return f"UPDATE dataset_rows\nSET data = data - {removal}"

    elif operation == "duplicate_column":
        return (
            f"UPDATE dataset_rows\n"
            f"SET data = data || jsonb_build_object(\n"
            f"  '{p['new_column_name']}', data->'{p['column_name']}')"
        )

    elif operation == "find_replace":
        return (
            f"UPDATE dataset_rows\n"
            f"SET data = jsonb_set(data, '{{{p['column_name']}}}',\n"
            f"  to_jsonb(REPLACE(data->>'{p['column_name']}',\n"
            f"    '{p['find_value']}', '{p['replace_value']}')))\n"
            f"WHERE data->>'{p['column_name']}' LIKE '%{p['find_value']}%'"
        )

    elif operation == "filter_rows":
        op = p["operator"]
        val = p.get("value", "")
        return (
            f"DELETE FROM dataset_rows\n"
            f"WHERE NOT (data->>'{p['column_name']}' {op} '{val}')"
        )

    elif operation == "window_aggregate":
        agg = p["aggregation"].upper()
        w = p["window"]
        return (
            f"SELECT {agg}((data->>'{p['column_name']}')::numeric)\n"
            f"  OVER (ORDER BY row_number\n"
            f"    ROWS BETWEEN {w - 1} PRECEDING AND CURRENT ROW)\n"
            f"  AS {p['new_column_name']}"
        )

    elif operation == "shift_column":
        periods = p["periods"]
        fn = "LAG" if periods > 0 else "LEAD"
        return (
            f"SELECT {fn}(data->>'{p['column_name']}', {abs(periods)})\n"
            f"  OVER (ORDER BY row_number)\n"
            f"  AS {p['new_column_name']}"
        )

    elif operation == "column_formula":
        return (
            f"UPDATE dataset_rows\n"
            f"SET data = data || jsonb_build_object(\n"
            f"  '{p['new_column_name']}',\n"
            f"  ROUND(({p['expression']})::numeric, 4))"
        )

    elif operation == "case_when":
        return (
            f"UPDATE dataset_rows\n"
            f"SET data = data || jsonb_build_object(\n"
            f"  '{p['new_column_name']}',\n"
            f"  CASE\n"
            f"    WHEN {p['column_name']} {p['operator']} {p['compare_value']}\n"
            f"    THEN '{p['then_value']}'\n"
            f"    ELSE '{p['else_value']}'\n"
            f"  END)"
        )

    elif operation == "format_values":
        return (
            f"UPDATE dataset_rows\n"
            f"SET data = data || jsonb_build_object(\n"
            f"  '{p['new_column_name']}',\n"
            f"  -- template: {p['template']})"
        )

    elif operation == "run_transform":
        return (
            f"-- LLM transform\n"
            f"-- Prompt: {p.get('prompt', 'N/A')}\n"
            f"-- Source column: {p.get('source_column', 'N/A')}\n"
            f"-- New column: {p.get('new_column_name', 'N/A')}"
        )

    return f"-- {operation}\n-- params: {json.dumps(p, default=str)}"


def reset_dataset(dataset_id: str, user_id: str) -> dict:
    """Reset dataset to original upload state."""
    ds = verify_dataset_ownership(dataset_id, user_id)

    # Clear all pipeline steps
    supabase_admin.table("pipeline_steps").delete().eq("dataset_id", dataset_id).execute()

    # Restore from original
    _restore_from_original(dataset_id)

    # Get original columns
    original_columns = ds.get("original_columns")
    if not original_columns:
        # Fallback: infer from original rows
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT data FROM dataset_rows_original WHERE dataset_id = %s LIMIT 1",
                    (dataset_id,),
                )
                row = cur.fetchone()
                original_columns = list(row[0].keys()) if row else ds["columns"]

    update_dataset_metadata_sql(dataset_id, original_columns)

    return {"columns": original_columns, "row_count": ds["row_count"]}


# ---------------------------------------------------------------------------
# Job runner
# ---------------------------------------------------------------------------


async def run_job(job_id: str, user_id: str, dataset_id: str, column_name: str,
                  prompt: str, new_column_name: str):
    """Run a processing job with parallel batch calls. Reads/writes via SQL."""
    cancel = asyncio.Event()
    _cancel_events[job_id] = cancel

    try:
        # Read source column via SQL
        with get_pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT row_number, data->>%s FROM dataset_rows "
                    "WHERE dataset_id = %s ORDER BY row_number",
                    (column_name, dataset_id),
                )
                source_rows = cur.fetchall()

        total = len(source_rows)
        row_numbers = [r[0] for r in source_rows]
        texts = [r[1] if r[1] is not None else "" for r in source_rows]

        batches, skipped = create_batches(texts)

        balance = await get_openrouter_balance()
        concurrency = get_concurrency_limit(balance)
        semaphore = asyncio.Semaphore(concurrency)

        if balance >= 0:
            log.info(f"Job {job_id}: {total} rows, {len(batches)} batch(es), {len(skipped)} skipped | "
                     f"OpenRouter balance: ${balance:.2f} -> {concurrency} concurrent calls")
        else:
            log.info(f"Job {job_id}: {total} rows, {len(batches)} batch(es), {len(skipped)} skipped | "
                     f"OpenRouter balance: unknown -> {concurrency} concurrent calls (fallback)")

        all_results: dict[int, str] = dict(skipped)
        processed = len(skipped)
        progress_lock = asyncio.Lock()

        async def process_batch(batch):
            nonlocal processed
            if cancel.is_set():
                return {}
            async with semaphore:
                if cancel.is_set():
                    return {}
                batch_results = await apply_llm_batch(batch, prompt)
            async with progress_lock:
                all_results.update(batch_results)
                processed += len(batch)
                await asyncio.to_thread(update_job, job_id, rows_processed=processed)
                log.info(f"Job {job_id} progress: {processed}/{total}")
            return batch_results

        await asyncio.gather(*[process_batch(b) for b in batches])

        # Build column values indexed by position
        column_values = [all_results.get(i, "") for i in range(total)]

        if cancel.is_set():
            # Write partial results via SQL
            await asyncio.to_thread(
                _write_column_values_sql, dataset_id, new_column_name, row_numbers, column_values
            )
            update_job(job_id, status="cancelled", rows_processed=processed)
            log.info(f"Job {job_id} cancelled at {processed}/{total} rows")
            return

        # Write results via SQL
        await asyncio.to_thread(
            _write_column_values_sql, dataset_id, new_column_name, row_numbers, column_values
        )

        # Get updated columns and update metadata
        ds = (
            supabase_admin.table("datasets")
            .select("columns")
            .eq("id", dataset_id)
            .single()
            .execute()
        )
        new_columns = ds.data["columns"] + [new_column_name]
        await asyncio.to_thread(update_dataset_metadata_sql, dataset_id, new_columns)
        await asyncio.to_thread(
            record_pipeline_step, dataset_id, "run_transform",
            {"column_name": column_name, "prompt": prompt,
             "new_column_name": new_column_name},
            f"Generated {total} values",
            column_values,
        )
        log.info(f"Dataset {dataset_id} updated with new column '{new_column_name}'")

        await asyncio.to_thread(
            update_job, job_id, status="completed", rows_processed=total,
            completed_at=datetime.now(timezone.utc).isoformat(),
        )
        log.info(f"Job {job_id} completed")

    except Exception as e:
        log.error(f"Job {job_id} failed: {e}")
        update_job(job_id, status="failed", error_message=str(e))
    finally:
        _cancel_events.pop(job_id, None)


def _write_column_values_sql(dataset_id: str, column_name: str,
                              row_numbers: list[int], values: list[str]):
    """Bulk-write a list of values as a new column to dataset_rows via SQL."""
    _safe_col(column_name)
    with get_pg_conn() as conn:
        with conn.cursor() as cur:
            # Use batch updates for efficiency
            batch_size = 500
            for i in range(0, len(row_numbers), batch_size):
                batch_rns = row_numbers[i:i + batch_size]
                batch_vals = values[i:i + batch_size]
                for rn, val in zip(batch_rns, batch_vals):
                    cur.execute(
                        "UPDATE dataset_rows SET data = data || jsonb_build_object(%s, %s) "
                        "WHERE dataset_id = %s AND row_number = %s",
                        (column_name, val, dataset_id, rn),
                    )
        conn.commit()
