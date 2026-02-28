"use client";

import { useState, useEffect, useRef } from "react";
import {
  isInitialized as isDuckDBInitialized,
  getCurrentUserId,
} from "./duckdb";
import { isInitialized as isWebRInitialized } from "./webr";

export type RuntimeStatus = "loading" | "ready" | "error";

export interface RuntimeState {
  status: RuntimeStatus;
  progress: string;
  error: string | null;
  duckdbReady: boolean;
}

export function useRuntime(userId?: string): RuntimeState {
  // Only seed as "ready" if both runtimes are up AND DuckDB is for the same user
  const duckdbMatchesUser =
    isDuckDBInitialized() && getCurrentUserId() === (userId ?? null);

  const [status, setStatus] = useState<RuntimeStatus>(
    duckdbMatchesUser && isWebRInitialized() ? "ready" : "loading"
  );
  const [progress, setProgress] = useState(() =>
    duckdbMatchesUser && isWebRInitialized() ? "Ready" : "Initializing..."
  );
  const [error, setError] = useState<string | null>(null);
  const [duckdbReady, setDuckdbReady] = useState(duckdbMatchesUser);
  const started = useRef(false);
  const prevUserId = useRef<string | undefined>(userId);

  // When userId changes and no longer matches the DuckDB singleton, reset
  useEffect(() => {
    if (prevUserId.current !== userId && userId) {
      prevUserId.current = userId;
      // If DuckDB is already for a different user (or not initialized), re-init
      if (getCurrentUserId() !== userId) {
        started.current = false;
        setDuckdbReady(false);
        setStatus("loading");
        setProgress("Switching user...");
      }
    }
  }, [userId]);

  useEffect(() => {
    if (started.current) return;
    if (!userId) return; // Wait for auth to provide userId
    started.current = true;

    // Always call initDuckDB — it's idempotent for same user, handles switch for different user
    (async () => {
      try {
        if (!isDuckDBInitialized() || getCurrentUserId() !== userId) {
          setProgress("Loading DuckDB...");
        }
        const { initDuckDB } = await import("./duckdb");
        await initDuckDB(userId);
        setDuckdbReady(true);

        if (!isWebRInitialized()) {
          setProgress("Loading WebR...");
          const { initWebR, setProgressCallback } = await import("./webr");
          setProgressCallback((msg) => setProgress(msg));
          await initWebR();
          setProgressCallback(null);
        }

        setProgress("Ready");
        setStatus("ready");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus("error");
        setProgress(`Error: ${msg}`);
      }
    })();
  }, [userId]);

  return { status, progress, error, duckdbReady };
}
