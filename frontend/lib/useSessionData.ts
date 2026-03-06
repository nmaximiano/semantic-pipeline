"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import * as localSessions from "@/lib/sessions";
import type { DatasetMeta } from "@/lib/registry";
import type { Session } from "@supabase/supabase-js";
import { API } from "@/lib/api";
import { flushCheckpoint } from "@/lib/duckdb";
import type { UsageInfo } from "@/components/SettingsMenu";

export function useSessionData(sessionId: string, duckdbReady: boolean) {
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageInfo | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sessionName, setSessionName] = useState("");
  const [sessionDatasets, setSessionDatasets] = useState<DatasetMeta[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Refs that mirror state — used by async functions to avoid stale closures
  const sessionDatasetsRef = useRef(sessionDatasets);
  sessionDatasetsRef.current = sessionDatasets;

  // Session rename state
  const [isRenamingSession, setIsRenamingSession] = useState(false);
  const [sessionRenameValue, setSessionRenameValue] = useState("");
  const sessionRenameRef = useRef<HTMLInputElement>(null);

  // Auth initialization + subscription
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
        return;
      }
      setSession(session);
      setAuthLoading(false);
      fetchAccount(session.access_token);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.push("/login");
        return;
      }
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, [router, sessionId]);

  // Load session data once DuckDB is ready
  useEffect(() => {
    if (session && !authLoading && duckdbReady) {
      fetchSessionLocal();
    }
  }, [session, authLoading, duckdbReady, sessionId]);

  async function fetchAccount(token: string) {
    try {
      const res = await fetch(`${API}/account`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPlan(data.plan);
        setUsage({ credits_used: data.credits_used, credits_limit: data.credits_limit, period_start: data.period_start });
      }
    } catch (e) {
      console.error("[useSessionData] fetchAccount failed:", e);
    }
  }

  async function refreshUsage() {
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s) fetchAccount(s.access_token);
  }

  async function fetchSessionLocal() {
    try {
      const data = await localSessions.getSession(sessionId);
      if (!data) {
        throw new Error("Session not found");
      }
      setSessionName(data.name);
      const dsList: DatasetMeta[] = data.datasets.map((d) => ({
        id: d.id,
        filename: d.filename,
        columns: d.columns,
        row_count: d.row_count,
        file_size_bytes: d.file_size_bytes,
        created_at: data.created_at,
        r_name: d.r_name,
      }));
      setSessionDatasets(dsList);
      // Auto-select first dataset, or switch if active was removed
      const dsIds = new Set(dsList.map((d) => d.id));
      if (dsList.length > 0 && (!activeDatasetId || !dsIds.has(activeDatasetId))) {
        setActiveDatasetId(dsList[0].id);
      }
      setLoading(false);
    } catch (e: any) {
      setError(e.message || "Failed to load session");
      setLoading(false);
    }
  }

  async function handleSessionRename() {
    if (!session || !sessionRenameValue.trim()) {
      setIsRenamingSession(false);
      return;
    }
    const name = sessionRenameValue.trim();
    try {
      await localSessions.renameSession(sessionId, name);
      setSessionName(name);
    } catch (e) {
      console.error("[useSessionData] handleSessionRename failed:", e);
    }
    setIsRenamingSession(false);
  }

  async function handleLogout() {
    await flushCheckpoint();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return {
    session, plan, usage, authLoading,
    sessionName, setSessionName,
    sessionDatasets, setSessionDatasets, sessionDatasetsRef,
    activeDatasetId, setActiveDatasetId,
    loading, error, setError,
    // Session rename
    isRenamingSession, setIsRenamingSession,
    sessionRenameValue, setSessionRenameValue,
    sessionRenameRef, handleSessionRename,
    handleLogout,
    fetchSessionLocal,
    refreshUsage,
  };
}
