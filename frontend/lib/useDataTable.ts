"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import type { RowsResponse } from "@/lib/session-types";

export interface DataTableRefetchArgs {
  activeStableId: string;
  page: number;
  perPage: number;
  sortCol: string | undefined;
  sortDir: "asc" | "desc";
}

export function useDataTable(
  activeStableId: string | null,
  duckdbReady: boolean,
) {
  const [rowsCache, setRowsCache] = useState<Record<string, RowsResponse>>({});
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [refreshing, setRefreshing] = useState(false);
  const [activeCell, setActiveCell] = useState<[number, number] | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Ref-based refetch callback — set by the page after defining fetchObjectRows
  const refetchRef = useRef<((args: DataTableRefetchArgs) => void) | null>(null);

  const rowsData = activeStableId ? rowsCache[activeStableId] || null : null;
  const numRows = rowsData?.rows.length ?? 0;
  const numCols = rowsData?.columns.length ?? 0;
  const totalRows = rowsData?.total ?? 0;
  const totalPages = rowsData ? Math.ceil(totalRows / rowsData.per_page) || 1 : 1;
  const startRow = rowsData ? (rowsData.page - 1) * rowsData.per_page + 1 : 0;
  const endRow = rowsData
    ? Math.min(rowsData.page * rowsData.per_page, totalRows)
    : 0;
  const activeCellValue =
    activeCell && rowsData && activeCell[0] >= 0
      ? String(rowsData.rows[activeCell[0]]?.[activeCell[1]] ?? "")
      : activeCell && rowsData && activeCell[0] === -1
        ? rowsData.columns[activeCell[1]] ?? ""
        : null;

  // Suppress refetch during pagination reset (handleObjectTabClick already fetches)
  const suppressRefetch = useRef(false);

  // Reset pagination on active object change
  useEffect(() => {
    if (duckdbReady && activeStableId) {
      suppressRefetch.current = true;
      setPage(1);
      setSortCol(null);
      setSortDir("asc");
      setActiveCell(null);
    }
  }, [activeStableId, duckdbReady]);

  // Re-fetch rows when pagination/sort changes
  useEffect(() => {
    if (suppressRefetch.current) {
      suppressRefetch.current = false;
      return;
    }
    if (duckdbReady && activeStableId) {
      refetchRef.current?.({ activeStableId, page, perPage, sortCol: sortCol ?? undefined, sortDir });
    }
  }, [page, perPage, sortCol, sortDir]);

  // Scroll active cell into view
  useEffect(() => {
    if (!activeCell || !tableRef.current) return;
    const [r, c] = activeCell;
    const selector =
      r === -1
        ? `thead th:nth-child(${c + 1})`
        : `tbody tr:nth-child(${r + 1}) td:nth-child(${c + 1})`;
    const el = tableRef.current.querySelector(selector);
    if (el) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeCell]);

  function handleSort(col: string) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
    setPage(1);
  }

  function handlePerPageChange(newPerPage: number) {
    setPerPage(newPerPage);
    setPage(1);
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!rowsData || numRows === 0 || numCols === 0) return;

      const [r, c] = activeCell ?? [0, 0];
      let nr = r;
      let nc = c;
      let handled = true;

      switch (e.key) {
        case "ArrowUp":
          nr = Math.max(-1, r - 1);
          break;
        case "ArrowDown":
          nr = Math.min(numRows - 1, r + 1);
          break;
        case "ArrowLeft":
          nc = Math.max(0, c - 1);
          break;
        case "ArrowRight":
          nc = Math.min(numCols - 1, c + 1);
          break;
        case "Tab":
          e.preventDefault();
          if (e.shiftKey) {
            if (c > 0) {
              nc = c - 1;
            } else if (r > -1) {
              nr = r - 1;
              nc = numCols - 1;
            }
          } else {
            if (c < numCols - 1) {
              nc = c + 1;
            } else if (r < numRows - 1) {
              nr = r + 1;
              nc = 0;
            }
          }
          break;
        case "Enter":
          if (e.shiftKey) {
            nr = Math.max(-1, r - 1);
          } else {
            nr = Math.min(numRows - 1, r + 1);
          }
          break;
        case "Home":
          if (e.ctrlKey || e.metaKey) {
            nr = -1;
            nc = 0;
          } else {
            nc = 0;
          }
          break;
        case "End":
          if (e.ctrlKey || e.metaKey) {
            nr = numRows - 1;
            nc = numCols - 1;
          } else {
            nc = numCols - 1;
          }
          break;
        case "PageUp":
          nr = Math.max(-1, r - 20);
          break;
        case "PageDown":
          nr = Math.min(numRows - 1, r + 20);
          break;
        default:
          handled = false;
      }

      if (handled) {
        e.preventDefault();
        setActiveCell([nr, nc]);
      }
    },
    [activeCell, numRows, numCols, rowsData]
  );

  const resetPagination = useCallback(() => {
    setPage(1);
    setSortCol(null);
    setSortDir("asc");
    setActiveCell(null);
  }, []);

  return {
    rowsCache, setRowsCache,
    page, setPage, perPage, sortCol, setSortCol, sortDir, setSortDir,
    refreshing, setRefreshing,
    activeCell, setActiveCell,
    tableRef,
    rowsData,
    refetchRef,
    handleSort, handlePerPageChange, handleKeyDown,
    totalRows, totalPages, startRow, endRow, activeCellValue,
    resetPagination,
  };
}
