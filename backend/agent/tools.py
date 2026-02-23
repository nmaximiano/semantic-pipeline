from __future__ import annotations
import asyncio
import logging
from typing import TYPE_CHECKING
from langchain_core.tools import tool

if TYPE_CHECKING:
    from langchain_core.tools import BaseTool

log = logging.getLogger(__name__)


def make_tools(active_dataset_id: str, user_id: str,
               open_datasets: list[dict] | None = None,
               session_id: str | None = None) -> list[BaseTool]:
    """Create tools that operate on dataset_rows via SQL.

    All tools accept an optional ``dataset`` parameter (filename or ID).
    When omitted the active dataset is used.
    """

    # Build lookup tables for resolving dataset by name or id
    _open = open_datasets or []
    _id_set: set[str] = {ds["id"] for ds in _open}
    _id_set.add(active_dataset_id)
    _name_to_id: dict[str, str] = {ds["filename"]: ds["id"] for ds in _open}

    def _resolve(dataset: str = "") -> str:
        """Resolve an optional dataset reference to a concrete dataset_id."""
        if not dataset:
            return active_dataset_id
        if dataset in _id_set:
            return dataset
        if dataset in _name_to_id:
            return _name_to_id[dataset]
        available = ", ".join(f'"{ds["filename"]}"' for ds in _open)
        raise ValueError(
            f"Dataset '{dataset}' not found in this session. "
            f"Available datasets: {available}"
        )

    @tool
    def sample_rows_tool(n: int = 5, dataset: str = "") -> str:
        """Get a sample of rows from a dataset to inspect actual data values.
        Use this before performing transformations so you understand the data.
        This is a read-only operation — it does not modify the dataset.

        Parameters:
          n: number of rows to sample (default 5)
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)"""
        from services import sample_dataset_rows
        try:
            did = _resolve(dataset)
            result = sample_dataset_rows(did, user_id, n)
            lines = [f"Columns: {result['columns']}", f"Total rows: {result['row_count']}", ""]
            for i, row in enumerate(result["sample"], 1):
                row_str = " | ".join(f"{k}: {v}" for k, v in row.items())
                lines.append(f"  {i}. {row_str}")
            return "\n".join(lines)
        except ValueError as e:
            return str(e)

    @tool
    def column_stats_tool(column_name: str, dataset: str = "") -> str:
        """Get summary statistics for a column: count, unique values, top values,
        min/max/mean (if numeric), and string length stats.
        Use this to understand a column's data distribution before acting on it.
        This is a read-only operation — it does not modify the dataset.

        Parameters:
          column_name: the column to analyze
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)"""
        from services import column_statistics
        try:
            did = _resolve(dataset)
            s = column_statistics(did, user_id, column_name)
            lines = [
                f"Column: {column_name}",
                f"Total: {s['total']} | Non-null: {s['non_null']} | Empty: {s['empty']} | Unique: {s['unique']}",
            ]
            if "mean" in s:
                lines.append(f"Numeric — min: {s['min']}, max: {s['max']}, mean: {s['mean']}, median: {s['median']}")
            if "avg_length" in s:
                lines.append(f"String length — avg: {s['avg_length']}, min: {s['min_length']}, max: {s['max_length']}")
            if s["top_values"]:
                top = ", ".join(f'"{k}" ({v})' for k, v in s["top_values"].items())
                lines.append(f"Top values: {top}")
            return "\n".join(lines)
        except ValueError as e:
            return str(e)

    @tool
    def distribution_tool(column_name: str, dataset: str = "") -> str:
        """Get the full distribution of values in a column.
        Auto-detects data type and returns the appropriate breakdown:
        - Low cardinality (<=50 unique): full value counts with percentages
        - Numeric: ~10 histogram bins with ranges, plus summary stats
        - Date: bins by auto-detected time period (year/month/day)
        - Text: histogram bins on string length
        Use this to answer questions about distributions, frequencies,
        most/least common values, or how data is spread.
        This is a read-only operation — it does not modify the dataset.

        Parameters:
          column_name: the column to analyze
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)"""
        from services import column_distribution
        try:
            did = _resolve(dataset)
            d = column_distribution(did, user_id, column_name)
            if d["type"] == "empty":
                return f"Column '{column_name}' has no non-null values."

            lines = [f"Column: {column_name}", f"Total non-null: {d['total']}"]

            if d["type"] == "value_counts":
                lines.append("Distribution (value counts):")
                for v in d["values"]:
                    lines.append(f"  {v['value']}: {v['count']} ({v['pct']}%)")

            elif d["type"] == "histogram":
                subtype = d["subtype"]
                if subtype == "numeric":
                    lines.append(f"Numeric — min: {d['min']}, max: {d['max']}, "
                                 f"mean: {d['mean']}, median: {d['median']}, std: {d['std']}")
                    lines.append("Histogram bins:")
                    for b in d["bins"]:
                        lines.append(f"  {b['range']}: {b['count']}")
                elif subtype == "date":
                    lines.append(f"Date range: {d['min_date']} to {d['max_date']} (binned by {d['period']})")
                    lines.append("Histogram bins:")
                    for b in d["bins"]:
                        lines.append(f"  {b['range']}: {b['count']}")
                elif subtype == "text_length":
                    lines.append(f"Text length — avg: {d['avg_length']} chars")
                    lines.append("Length distribution:")
                    for b in d["bins"]:
                        lines.append(f"  {b['range']}: {b['count']}")

            return "\n".join(lines)
        except ValueError as e:
            return str(e)

    @tool
    def find_replace_tool(column_name: str, find_value: str, replace_value: str,
                          dataset: str = "") -> str:
        """Find and replace text in a column. Replaces all occurrences of
        find_value with replace_value across every row in the column.
        Use this when the user asks to replace, substitute, fix, or standardize
        values in a column.

        Parameters:
          column_name: the column to modify
          find_value: text to find
          replace_value: replacement text
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)"""
        from services import find_replace
        try:
            did = _resolve(dataset)
            result = find_replace(did, user_id, column_name, find_value, replace_value)
            return (
                f"Replaced '{find_value}' -> '{replace_value}' in column '{column_name}': "
                f"{result['cells_changed']} cells changed."
            )
        except ValueError as e:
            return str(e)

    @tool
    def rename_column_tool(old_name: str, new_name: str, dataset: str = "") -> str:
        """Rename a column in the dataset.
        Use this when the user asks to rename, change the name of, or relabel a column.

        Parameters:
          old_name: current column name
          new_name: desired new name
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)"""
        from services import rename_column as _rename
        try:
            did = _resolve(dataset)
            result = _rename(did, user_id, old_name, new_name)
            return f"Renamed '{old_name}' -> '{new_name}'. Columns: {result['columns']}"
        except ValueError as e:
            return str(e)

    @tool
    def rename_columns_tool(renames: dict, dataset: str = "") -> str:
        """Rename multiple columns at once. Use this instead of rename_column_tool
        when you need to rename 2 or more columns (e.g. before a join to prefix
        overlapping column names).

        Parameters:
          renames: a dict mapping old column names to new column names, e.g.
                   {"Open": "SPX_Open", "High": "SPX_High", "Low": "SPX_Low"}
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)"""
        from services import rename_columns as _rename_multi
        try:
            did = _resolve(dataset)
            result = _rename_multi(did, user_id, renames)
            pairs = ", ".join(f"'{k}' -> '{v}'" for k, v in result["renamed"].items())
            return f"Renamed {len(result['renamed'])} columns: {pairs}. Columns: {result['columns']}"
        except ValueError as e:
            return str(e)

    @tool
    def delete_columns_tool(column_names: list[str], dataset: str = "") -> str:
        """Delete one or more columns from the dataset.
        Use this when the user asks to remove, drop, or delete columns.
        Pass a list of column names to delete multiple at once.

        Parameters:
          column_names: list of column names to delete
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)"""
        from services import delete_columns as _delete
        try:
            did = _resolve(dataset)
            result = _delete(did, user_id, column_names)
            return (
                f"Deleted {len(result['deleted'])} columns: {result['deleted']}. "
                f"Remaining: {result['columns']}"
            )
        except ValueError as e:
            return str(e)

    @tool
    def duplicate_column_tool(column_name: str, new_column_name: str,
                              dataset: str = "") -> str:
        """Copy a column to a new column with a different name.
        Use this when the user wants to duplicate, copy, or back up a column
        before transforming it.

        Parameters:
          column_name: source column to copy
          new_column_name: name for the new column
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)"""
        from services import duplicate_column as _dup
        try:
            did = _resolve(dataset)
            result = _dup(did, user_id, column_name, new_column_name)
            return (
                f"Duplicated '{column_name}' -> '{new_column_name}'. "
                f"Columns: {result['columns']}"
            )
        except ValueError as e:
            return str(e)

    @tool
    def filter_rows_tool(column_name: str, operator: str, value: str = "",
                         dataset: str = "") -> str:
        """Filter rows in the dataset, keeping only rows that match the condition.
        Use this when the user asks to filter, remove, keep, or exclude rows.

        Apply one condition at a time. For multiple AND conditions, call this
        tool multiple times in sequence.

        Supported operators: =, !=, >, <, >=, <=, contains, not_contains,
        is_empty, is_not_empty, in, not_in.

        For 'in' and 'not_in', pass a comma-separated list of values, e.g.
        value="Politics,Elections". This matches rows where the column value
        equals ANY of the listed values (OR logic).

        The value parameter is ignored for is_empty and is_not_empty operators.
        Numeric comparison is used automatically when both the column values
        and the filter value are numeric.

        Parameters:
          column_name: the column to filter on
          operator: comparison operator
          value: value to compare against
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)"""
        from services import filter_rows as _filter
        try:
            did = _resolve(dataset)
            result = _filter(did, user_id, column_name, operator, value)
            return (
                f"Filtered '{column_name}' {operator} '{value}': "
                f"removed {result['rows_removed']} rows, {result['row_count']} remaining."
            )
        except ValueError as e:
            return str(e)

    @tool
    def sort_dataset_tool(column_name: str, direction: str = "asc",
                          sort_type: str = "text", dataset: str = "") -> str:
        """Sort the entire dataset by a column, persistently reordering all
        rows. This changes the physical row order that rolling_window,
        shift_column, and other positional tools operate on.

        Parameters:
          column_name: the column to sort by
          direction: 'asc' (ascending, default) or 'desc' (descending)
          sort_type: how to interpret values for sorting. One of:
            - 'text'    — alphabetical sort (default)
            - 'numeric' — numeric sort (values like 1, 2.5, -3)
            - 'date'    — date/time sort. Supported formats:
                  2025-01-15  or  2025-01-15 14:30:00  (ISO 8601)
                  01/15/2025  (US: MM/DD/YYYY)
                  Jan 15, 2025  or  January 15, 2025  (month name)
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)

        IMPORTANT: Always use this tool BEFORE rolling_window or shift_column
        when working with time-series data. Sort ascending (oldest first) for
        correct moving averages, lags, and percent changes.

        IMPORTANT: For sort_type='date', the column values MUST already be in
        one of the supported date formats listed above. If the column contains
        non-standard date strings (e.g. Unix timestamps, "Feb 2025", relative
        dates), use format_values_tool to reformat the column into a supported
        date format BEFORE sorting. For ISO 8601 dates (YYYY-MM-DD...) you can
        also use sort_type='text' since they sort correctly alphabetically.

        This is free — no credits are charged."""
        from services import sort_dataset as _sort
        try:
            did = _resolve(dataset)
            result = _sort(did, user_id, column_name, direction, sort_type)
            return (
                f"Sorted {result['row_count']} rows by '{column_name}' "
                f"{direction} ({sort_type})."
            )
        except ValueError as e:
            return str(e)

    @tool
    def rolling_window_tool(column_name: str, window: int, aggregation: str,
                          new_column_name: str, dataset: str = "") -> str:
        """Compute a rolling (moving) statistic on a numeric column and write
        the result to a new column. Use this for moving averages, rolling sums,
        rolling min/max, etc.

        Parameters:
          column_name: the source numeric column
          window: number of rows in the rolling window (e.g. 30 for a 30-day MA)
          aggregation: one of mean, sum, min, max, median, std
          new_column_name: name for the new column
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)

        IMPORTANT — ROW ORDER: This tool computes over the current row order.
        For time-series data (e.g. 30-day moving average), the dataset MUST be
        sorted by the date/time column in ASCENDING order (oldest first) BEFORE
        calling this tool. If the data is in descending order, the window will
        look forward instead of backward — giving wrong results. Use
        sort_dataset_tool to sort first.

        The first (window - 1) rows will be null since there isn't enough
        preceding data. This is free — no credits are charged."""
        from services import window_aggregate as _window_agg
        try:
            did = _resolve(dataset)
            result = _window_agg(did, user_id, column_name, window,
                                 aggregation, new_column_name)
            return (
                f"Created '{result['new_column']}' with rolling {aggregation} over "
                f"{window}-row window. {result['non_null']} values computed, "
                f"{result['null']} null (insufficient window data)."
            )
        except ValueError as e:
            return str(e)

    @tool
    def shift_column_tool(column_name: str, periods: int,
                          new_column_name: str, dataset: str = "") -> str:
        """Create a new column by shifting (lagging or leading) an existing
        column by N rows. Use this when you need to reference a past or future
        value for comparison or calculation (e.g. percent change, day-over-day
        difference).

        Parameters:
          column_name: the source column to shift
          periods: number of rows to shift. Positive = lag (past values),
                   negative = lead (future values). E.g. 7 means each row
                   gets the value from 7 rows earlier.
          new_column_name: name for the new column
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)

        IMPORTANT — ROW ORDER: Shift direction depends on row order. For
        time-series data, the dataset MUST be sorted by the date/time column
        in ASCENDING order (oldest first) BEFORE calling this tool. If the
        data is in descending order, a positive shift (lag) will actually
        reference future values — giving wrong results. Use sort_dataset_tool
        to sort first.

        The first/last N rows will be null (no data to shift from).
        This is free — no credits are charged."""
        from services import shift_column as _shift
        try:
            did = _resolve(dataset)
            result = _shift(did, user_id, column_name, periods,
                            new_column_name)
            direction = "lagged" if periods > 0 else "leading"
            return (
                f"Created '{result['new_column']}' ({direction} by {abs(periods)} rows). "
                f"{result['non_null']} values, {result['null']} null."
            )
        except ValueError as e:
            return str(e)

    @tool
    def column_formula_tool(expression: str, new_column_name: str,
                            dataset: str = "") -> str:
        """Create a new column from an arithmetic expression over existing
        columns. Use this for calculations like ratios, percentages,
        differences, or any math between columns.

        Parameters:
          expression: arithmetic expression using column names and operators
                      (+, -, *, /, %). Examples:
                      "close / close_7d_ago"
                      "(high - low) / close * 100"
                      "volume * 0.001"
          new_column_name: name for the new column
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)

        This is free — no credits are charged."""
        from services import column_formula as _formula
        try:
            did = _resolve(dataset)
            result = _formula(did, user_id, expression, new_column_name)
            return (
                f"Created '{result['new_column']}' from expression: {expression}. "
                f"{result['non_null']} values computed, {result['null']} null."
            )
        except ValueError as e:
            return str(e)

    @tool
    def case_when_tool(column_name: str, operator: str, compare_value: str,
                       then_value: str, else_value: str,
                       new_column_name: str, dataset: str = "") -> str:
        """Create a conditional column: if column op value then X else Y.
        Use this for binary indicators, thresholds, or any if/else logic.

        Parameters:
          column_name: the column to test
          operator: one of =, !=, >, <, >=, <=
          compare_value: value to compare against — can be a number, string,
                         or another column name
          then_value: value when condition is true — can be a literal or column name
          else_value: value when condition is false — can be a literal or column name
          new_column_name: name for the new column
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)

        Examples:
          column_name="close", operator=">", compare_value="close_30d_ma",
          then_value="1", else_value="0" → binary indicator
          column_name="volume", operator=">", compare_value="1000000",
          then_value="high", else_value="low" → conditional column selection

        This is free — no credits are charged."""
        from services import case_when as _case
        try:
            did = _resolve(dataset)
            result = _case(did, user_id, column_name, operator,
                           compare_value, then_value, else_value,
                           new_column_name)
            return (
                f"Created '{result['new_column']}': "
                f"if {column_name} {operator} {compare_value} then {then_value} else {else_value}. "
                f"{result['non_null']} values computed, {result['null']} null."
            )
        except ValueError as e:
            return str(e)

    @tool
    def format_values_tool(parts: list, new_column_name: str,
                           dataset: str = "") -> str:
        """Create a new column by combining/formatting values from existing columns.
        Use for string concatenation, substring extraction, case conversion, or
        reformatting dates.

        parts: a list of objects to concatenate together. Each object is either:
          {"text": "literal string"}       — literal text
          {"column": "name"}               — insert column value
          {"column": "name", "upper": true}  — uppercase
          {"column": "name", "lower": true}  — lowercase
          {"column": "name", "trim": true}   — trim whitespace
          {"column": "name", "left": N}      — first N characters
          {"column": "name", "right": N}     — last N characters
          {"column": "name", "slice": [start, end]}  — substring (0-indexed)

        Examples:

          Reformat date from MM/DD/YYYY to YYYY-MM-DD:
          parts=[
            {"column": "Date", "slice": [6, 10]},
            {"text": "-"},
            {"column": "Date", "slice": [0, 2]},
            {"text": "-"},
            {"column": "Date", "slice": [3, 5]}
          ]

          Concatenate two columns with a space:
          parts=[{"column": "first_name"}, {"text": " "}, {"column": "last_name"}]

          Uppercase a column:
          parts=[{"column": "City", "upper": true}]

          Extract first 10 characters:
          parts=[{"column": "timestamp", "slice": [0, 10]}]

        new_column_name: name for the new column
        dataset: filename or ID (omit for active dataset)

        Free — no credits charged."""
        from services import format_values
        try:
            did = _resolve(dataset)
            result = format_values(did, user_id, template="",
                                   new_column_name=new_column_name, parts=parts)
            return (
                f"Created '{result['new_column']}'. "
                f"{result['non_null']} values computed, {result['null']} null."
            )
        except (ValueError, TypeError) as e:
            return f"Error: {e}"

    @tool
    def join_datasets_tool(left_dataset: str, right_dataset: str,
                           left_column: str, right_column: str,
                           join_type: str = "inner",
                           new_dataset_name: str = "") -> str:
        """Join two datasets on a key column, creating a new merged dataset.
        The source datasets are removed from the session and replaced by the
        joined result.

        Use this when the user wants to combine, merge, or join two datasets
        based on a shared key (e.g. date, ID).

        IMPORTANT — before calling this tool:
        1. Sample both datasets to understand their columns.
        2. If any non-key columns share the same name (e.g. both have "Volume",
           "Open", "Close"), rename them FIRST using rename_columns_tool (plural)
           so each name clearly identifies its source dataset. For example:
           - "Volume" in BTC dataset → "BTC_Volume"
           - "Volume" in S&P dataset → "SPX_Volume"
           Do NOT rely on the automatic _2 suffix — it produces unclear names.
        3. Only columns that are truly identical (like the join key) should
           keep the same name.

        Parameters:
          left_dataset: filename or ID of the left (primary) dataset
          right_dataset: filename or ID of the right dataset to join
          left_column: join key column in the left dataset
          right_column: join key column in the right dataset
          join_type: "inner" (only matching rows) or "left" (all left rows,
                     matching right rows). Default: "inner"
          new_dataset_name: optional name for the joined dataset
                            (defaults to "Left + Right")

        Column handling:
        - All columns from the left dataset are kept as-is
        - The right join-key column is dropped (redundant)
        - Conflicting column names from the right dataset get a _2 suffix
          (but you should avoid this by renaming beforehand)

        This is free — no credits are charged."""
        from services import join_datasets
        try:
            left_id = _resolve(left_dataset)
            right_id = _resolve(right_dataset)
            result = join_datasets(
                left_dataset_id=left_id,
                right_dataset_id=right_id,
                user_id=user_id,
                left_column=left_column,
                right_column=right_column,
                join_type=join_type,
                new_name=new_dataset_name or None,
                session_id=session_id,
            )
            lines = [
                f"Joined datasets into '{result['name']}': {result['row_count']} rows.",
                f"Columns: {result['columns']}",
            ]
            if result.get("conflict_renames"):
                renames = ", ".join(
                    f"'{k}' -> '{v}'" for k, v in result["conflict_renames"].items()
                )
                lines.append(f"Renamed conflicting columns: {renames}")
            lines.append(
                "Source datasets removed from session, joined dataset added."
            )
            return "\n".join(lines)
        except ValueError as e:
            return str(e)

    @tool
    async def llm_transform_tool(column_name: str, prompt: str, new_column_name: str,
                                 dataset: str = "") -> str:
        """Run an LLM transformation on a column to produce a new column.
        Use this when the user asks to classify, extract, translate, summarize,
        or otherwise transform/enrich text from one column into a new column.
        Requires Pro subscription. Uses weekly transform row quota.

        Parameters:
          column_name: source column to transform
          prompt: instruction for the LLM transformation
          new_column_name: name for the new output column
          dataset: filename or ID of the target dataset (defaults to active
                   dataset if omitted)"""
        from services import (
            supabase_admin, create_job, update_job, run_job,
        )

        try:
            did = _resolve(dataset)
        except ValueError as e:
            return str(e)

        # Fetch dataset metadata
        ds = (
            supabase_admin.table("datasets")
            .select("columns, row_count, col_avg_chars, filename")
            .eq("id", did)
            .eq("user_id", user_id)
            .single()
            .execute()
        )
        if not ds.data:
            return "Dataset not found."

        columns = ds.data["columns"]
        if column_name not in columns:
            return f"Column '{column_name}' does not exist. Available columns: {columns}"
        if new_column_name in columns:
            return f"Column '{new_column_name}' already exists."

        total = ds.data["row_count"]

        # Check transform row quota (replaces credit check)
        result = supabase_admin.rpc("use_transform_rows", {
            "p_user_id": user_id,
            "p_rows": total,
        }).execute()
        quota = result.data

        if not quota["allowed"]:
            if quota.get("transform_rows_limit", 0) == 0:
                return "LLM transforms require a Pro subscription. Upgrade at /credits to use this feature."
            used = quota["transform_rows_used"]
            limit = quota["transform_rows_limit"]
            return f"Weekly transform row limit reached ({used:,}/{limit:,}). Resets weekly."

        # Create job (no credits)
        filename = ds.data.get("filename", "dataset.csv")
        job_id = create_job(
            user_id=user_id,
            filename=filename,
            column_name=column_name,
            prompt=prompt,
            new_column_name=new_column_name,
            rows_total=total,
        )

        update_job(job_id, status="running")
        log.info(f"Agent llm_transform_tool: job {job_id}, {total} rows")

        # Fire-and-forget — pass dataset_id, not df
        asyncio.create_task(
            run_job(job_id, user_id, did, column_name, prompt,
                    new_column_name)
        )

        return (
            f"Started processing {total} rows from '{column_name}' -> '{new_column_name}'. "
            f"Job ID: {job_id}."
        )

    return [
        sample_rows_tool, column_stats_tool, distribution_tool,
        rename_column_tool, rename_columns_tool,
        delete_columns_tool, duplicate_column_tool,
        filter_rows_tool, find_replace_tool, format_values_tool,
        join_datasets_tool, sort_dataset_tool,
        rolling_window_tool, shift_column_tool, column_formula_tool,
        case_when_tool, llm_transform_tool,
    ]
