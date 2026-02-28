"use client";

import { useState, useRef, useEffect } from "react";
import { listREnvironment, getObjectSummary } from "@/lib/webr";
import { loadTableIntoR, saveRFrameToDuckDB } from "@/lib/webr-duckdb-bridge";
import { getTableRows as duckGetTableRows } from "@/lib/duckdb";
import * as localDatasets from "@/lib/datasets";
import * as localSessions from "@/lib/sessions";
import {
  type ObjectRegistryEntry,
  type DatasetMeta,
  getViewTableName,
  buildRegistry,
  cleanRVarName,
} from "@/lib/registry";
import type { RowsResponse } from "@/lib/session-types";
import type { RuntimeStatus } from "@/lib/useRuntime";

interface UseREnvironmentParams {
  sessionId: string;
  runtimeStatus: RuntimeStatus;
  sessionDatasets: DatasetMeta[];
  sessionDatasetsRef: React.MutableRefObject<DatasetMeta[]>;
  setSessionDatasets: React.Dispatch<React.SetStateAction<DatasetMeta[]>>;
  sessionDataLoaded: boolean;
  activeStableId: string | null;
  setActiveStableId: React.Dispatch<React.SetStateAction<string | null>>;
  setError: (msg: string) => void;
  setRowsCache: React.Dispatch<React.SetStateAction<Record<string, RowsResponse>>>;
  setSortCol: React.Dispatch<React.SetStateAction<string | null>>;
  setSortDir: React.Dispatch<React.SetStateAction<"asc" | "desc">>;
}

/** Wipe R global env and drop all _rview_ DuckDB tables. */
async function cleanRState() {
  try {
    const { evalR } = await import("@/lib/webr");
    await evalR(`rm(list = ls(envir = .GlobalEnv), envir = .GlobalEnv)`);
  } catch {}
  try {
    const { queryDuckDB } = await import("@/lib/duckdb");
    const tables = await queryDuckDB(
      `SELECT table_name FROM information_schema.tables WHERE table_name LIKE '_rview_%'`
    );
    for (const row of tables.rows) {
      try { await queryDuckDB(`DROP TABLE IF EXISTS "${row[0]}"`); } catch {}
    }
  } catch {}
}

/** Load .RData blobs, datasets, and replay R code history for a session. */
async function loadSessionIntoR(
  sessionId: string,
  sessionDatasets: DatasetMeta[],
): Promise<Map<string, string>> {
  // 1. Reload .RData blobs
  try {
    const { getRDataBlobs } = await import("@/lib/rdata");
    const blobs = await getRDataBlobs(sessionId);
    if (blobs.length > 0) {
      console.log(`[env-init] Reloading ${blobs.length} .RData blob(s)`);
      const webr = (await import("@/lib/webr")).getWebR();
      const { evalR } = await import("@/lib/webr");
      for (const { filename, blob } of blobs) {
        try {
          await webr!.FS.writeFile("/tmp/" + filename, blob);
          const ext = filename.split(".").pop()?.toLowerCase();
          if (ext === "rds") {
            const baseName = filename.replace(/\.rds$/i, "").replace(/[^a-zA-Z0-9_]/g, "_");
            await evalR(`${baseName} <- readRDS("/tmp/${filename}")`);
          } else {
            await evalR(`load("/tmp/${filename}")`);
          }
        } catch (e) {
          console.warn("[env-init] .RData blob reload failed:", filename, e);
        }
      }
    }
  } catch (e) {
    console.error("[env-init] .RData blob reload failed:", e);
  }

  // 2. Load datasets from DuckDB into R
  const loadedRNames = new Map<string, string>();
  for (const ds of sessionDatasets) {
    const tableName = await localDatasets.getDatasetTableName(ds.id);
    if (!tableName) continue;
    try {
      const rName = ds.r_name || cleanRVarName(ds.filename);
      console.log(`[env-init] Loading "${ds.filename}" as R var "${rName}"`);
      await loadTableIntoR(tableName, rName);
      loadedRNames.set(ds.id, rName);
      if (!ds.r_name) {
        await localSessions.updateSessionDatasetRName(sessionId, ds.id, rName);
      }
    } catch (e) {
      console.error(`[env-init] Failed to load "${ds.filename}":`, e);
    }
  }

  // 3. Replay R code history
  try {
    const { getRCodeHistory } = await import("@/lib/rCodeHistory");
    const history = await getRCodeHistory(sessionId);
    if (history.length > 0) {
      console.log(`[env-init] Replaying ${history.length} R commands`);
      const { evalR } = await import("@/lib/webr");
      for (const entry of history) {
        try { await evalR(entry.code); } catch (e) {
          console.warn(`[env-init] Replay failed:`, entry.code.slice(0, 50), e);
        }
      }
    }
  } catch (e) {
    console.error("[env-init] R code replay failed:", e);
  }

  return loadedRNames;
}

export function useREnvironment({
  sessionId,
  runtimeStatus,
  sessionDatasets,
  sessionDatasetsRef,
  setSessionDatasets,
  sessionDataLoaded,
  activeStableId,
  setActiveStableId,
  setError,
  setRowsCache,
  setSortCol,
  setSortDir,
}: UseREnvironmentParams) {
  const [registry, setRegistry] = useState<Map<string, ObjectRegistryEntry>>(new Map());
  const [objectSummary, setObjectSummary] = useState<string | null>(null);
  const [envReady, setEnvReady] = useState(false);
  const syncedToView = useRef<Set<string>>(new Set());
  const envInitDone = useRef(false);

  const registryRef = useRef(registry);
  registryRef.current = registry;

  // Derived convenience values
  const activeEntry = activeStableId ? registry.get(activeStableId) ?? null : null;
  const activeRName = activeEntry?.rName ?? null;
  const registryEntries = Array.from(registry.values());

  // ── Reset all env state when session changes ──
  const prevSessionId = useRef(sessionId);
  useEffect(() => {
    if (prevSessionId.current === sessionId) return;
    prevSessionId.current = sessionId;
    envInitDone.current = false;
    syncedToView.current.clear();
    setRegistry(new Map());
    setEnvReady(false);
    setObjectSummary(null);
  }, [sessionId]);

  // ── Initialize R environment once runtime + session data are ready ──
  useEffect(() => {
    if (runtimeStatus !== "ready" || !sessionDataLoaded || envInitDone.current) return;
    envInitDone.current = true;
    console.log("[env-init] Starting for session", sessionId, "with", sessionDatasets.length, "datasets");

    (async () => {
      // Always clean R state first — prevents leaking objects across sessions
      await cleanRState();
      syncedToView.current.clear();

      // Load this session's data into R
      const loadedRNames = await loadSessionIntoR(sessionId, sessionDatasets);

      // Sync r_name back to state if any were auto-generated
      if (loadedRNames.size > 0) {
        const updatedDsList = sessionDatasets.map(d => {
          const loaded = loadedRNames.get(d.id);
          return loaded && loaded !== d.r_name ? { ...d, r_name: loaded } : d;
        });
        setSessionDatasets(updatedDsList);
        sessionDatasetsRef.current = updatedDsList;
      }

      // Build registry from current R environment
      const objs = await listREnvironment();
      console.log("[env-init] R env after init:", objs.map(o => `${o.name}(${o.isDataFrame ? "df" : o.class})`));
      const newRegistry = buildRegistry(objs, sessionDatasetsRef.current, new Map());
      setRegistry(newRegistry);

      // Auto-select first data.frame
      const firstDf = Array.from(newRegistry.values()).find(e => e.isDataFrame);
      if (firstDf && !activeStableId) {
        setActiveStableId(firstDf.stableId);
        await fetchObjectRows(firstDf.stableId, firstDf.rName, 1, 50);
      }

      setEnvReady(true);
    })();
  }, [runtimeStatus, sessionDataLoaded, sessionId]);

  async function refreshEnv() {
    if (runtimeStatus !== "ready") return new Map<string, ObjectRegistryEntry>();
    const objs = await listREnvironment();
    console.log("[refreshEnv] Objects:", objs.map(o => `${o.name}(${o.isDataFrame ? `df:${o.nrow}x${o.ncol}` : o.class})`));
    const newReg = buildRegistry(objs, sessionDatasetsRef.current, registryRef.current);
    setRegistry(newReg);
    return newReg;
  }

  async function fetchObjectRows(
    stableId: string,
    rName: string,
    pg: number,
    pp: number,
    sc?: string,
    sd?: "asc" | "desc"
  ) {
    try {
      const viewTable = getViewTableName(stableId);
      if (!syncedToView.current.has(stableId)) {
        await saveRFrameToDuckDB(rName, viewTable);
        syncedToView.current.add(stableId);
      }
      try {
        const rows = await duckGetTableRows(viewTable, pg, pp, sc, sd);
        setRowsCache((prev) => ({ ...prev, [stableId]: rows as unknown as RowsResponse }));
      } catch (queryErr: any) {
        const msg = queryErr.message || "";
        if (/does not exist/i.test(msg)) {
          syncedToView.current.delete(stableId);
          await saveRFrameToDuckDB(rName, viewTable);
          syncedToView.current.add(stableId);
          const rows = await duckGetTableRows(viewTable, pg, pp, sc, sd);
          setRowsCache((prev) => ({ ...prev, [stableId]: rows as unknown as RowsResponse }));
        } else if (sc && /not found|Binder Error/i.test(msg)) {
          setSortCol(null);
          setSortDir("asc");
          const rows = await duckGetTableRows(viewTable, pg, pp);
          setRowsCache((prev) => ({ ...prev, [stableId]: rows as unknown as RowsResponse }));
        } else {
          throw queryErr;
        }
      }
    } catch (e: any) {
      setError(e.message || "Failed to load object data");
    }
  }

  async function handleObjectTabClick(stableId: string) {
    setActiveStableId(stableId);
    setObjectSummary(null);
    const entry = registry.get(stableId);
    if (!entry) return;
    if (entry.isDataFrame) {
      await fetchObjectRows(stableId, entry.rName, 1, 50);
    } else {
      const summary = await getObjectSummary(entry.rName);
      setObjectSummary(summary);
    }
  }

  async function resetEnv() {
    setEnvReady(false);

    // Clear persisted R code history + .RData blobs + console
    try { const { clearRCodeHistory } = await import("@/lib/rCodeHistory"); await clearRCodeHistory(sessionId); } catch {}
    try { const { clearRDataBlobs } = await import("@/lib/rdata"); await clearRDataBlobs(sessionId); } catch {}
    try { localStorage.removeItem(`rconsole_${sessionId}`); localStorage.removeItem(`rconsole_${sessionId}_cmds`); } catch {}

    // Wipe R state and reload datasets (without code replay)
    await cleanRState();
    syncedToView.current.clear();

    const loadedRNames = new Map<string, string>();
    for (const ds of sessionDatasetsRef.current) {
      const tableName = await localDatasets.getDatasetTableName(ds.id);
      if (!tableName) continue;
      try {
        const rName = ds.r_name || cleanRVarName(ds.filename);
        await loadTableIntoR(tableName, rName);
        loadedRNames.set(ds.id, rName);
      } catch (e) {
        console.error(`[resetEnv] Failed to load "${ds.filename}":`, e);
      }
    }

    const objs = await listREnvironment();
    const newRegistry = buildRegistry(objs, sessionDatasetsRef.current, new Map());
    setRegistry(newRegistry);

    const firstDf = Array.from(newRegistry.values()).find(e => e.isDataFrame);
    if (firstDf) {
      setActiveStableId(firstDf.stableId);
      await fetchObjectRows(firstDf.stableId, firstDf.rName, 1, 50);
    }

    envInitDone.current = true;
    setEnvReady(true);
  }

  return {
    registry, setRegistry, registryRef,
    objectSummary,
    activeEntry, activeRName, registryEntries,
    syncedToView, envInitDone, envReady,
    refreshEnv, fetchObjectRows, handleObjectTabClick, resetEnv,
  };
}
