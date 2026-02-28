"use client";

import { Suspense, useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/useTheme";
import { useRuntime } from "@/lib/useRuntime";
import RuntimeToast from "@/components/RuntimeToast";
import SettingsMenu from "@/components/SettingsMenu";
import * as sessions from "@/lib/sessions";
import * as datasets from "@/lib/datasets";
import type { Session } from "@supabase/supabase-js";
import { API } from "@/lib/api";
import { flushCheckpoint } from "@/lib/duckdb";

interface SessionMeta {
  id: string;
  name: string;
  dataset_count: number;
  dataset_names: string[];
  created_at: string;
  updated_at: string;
}

type SortKey = "date" | "name";
type SortDir = "asc" | "desc";

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* --- Sort dropdown --- */
function SortDropdown({
  sortKey,
  sortDir,
  onSort,
}: {
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const labels: Record<SortKey, string> = { date: "Recent", name: "Name" };
  const arrow = sortDir === "asc" ? "\u2191" : "\u2193";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-2 py-2 px-4 rounded-lg text-sm font-medium text-text-muted hover:text-text hover:bg-surface-alt transition-colors border border-border"
      >
        {labels[sortKey]} {arrow}
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg z-20 py-1">
          {(Object.keys(labels) as SortKey[]).map((k) => (
              <button
                key={k}
                onClick={() => { onSort(k); setOpen(false); }}
                className={`w-full text-left px-4 py-2 text-sm hover:bg-surface-alt transition-colors flex items-center justify-between ${
                  sortKey === k ? "text-accent font-medium" : "text-text"
                }`}
              >
                {labels[k]}
                {sortKey === k && <span className="text-accent">{arrow}</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/* --- Card skeleton --- */
function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="h-5 w-3/4 rounded animate-shimmer mb-4" />
      <div className="flex gap-2 mb-4">
        <div className="h-5 w-20 rounded-full animate-shimmer" />
        <div className="h-5 w-16 rounded-full animate-shimmer" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-4 w-16 rounded animate-shimmer" />
        <div className="h-4 w-12 rounded animate-shimmer" />
      </div>
    </div>
  );
}

/* --- Grid skeleton layout --- */
function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/* --- Main dashboard content --- */
function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, toggle: toggleTheme } = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const { status: runtimeStatus, progress: runtimeProgress, duckdbReady } = useRuntime(session?.user?.id);

  // Flush pending DuckDB WAL to OPFS before page unload (prevents data loss)
  useEffect(() => {
    const handler = () => { flushCheckpoint(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Surface OPFS quota errors as a dismissible banner
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      setStorageWarning((e as CustomEvent).detail);
    };
    window.addEventListener("duckdb-storage-error", handler);
    return () => window.removeEventListener("duckdb-storage-error", handler);
  }, []);

  const [plan, setPlan] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Sessions state
  const [sessionList, setSessionList] = useState<SessionMeta[] | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);

  // Navigation state (loading indicator on clicked card)
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  // New session modal state
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState("");
  const [creatingSession, setCreatingSession] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; name: string }[]>([]);
  const [modalDragging, setModalDragging] = useState(false);
  const modalDragCounter = useRef(0);
  const modalFileRef = useRef<HTMLInputElement>(null);

  // Sort state
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Search state
  const [search, setSearch] = useState("");

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  // Sorted + filtered sessions
  const filteredSessions = useMemo(() => {
    if (!sessionList) return null;
    let list = [...sessionList];

    // Filter by search
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.dataset_names.some((n) => n.toLowerCase().includes(q))
      );
    }

    // Sort
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
      else if (sortKey === "name") cmp = a.name.localeCompare(b.name);
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [sessionList, sortKey, sortDir, search]);

  /* --- refreshData: reload sessions from DuckDB --- */
  const refreshData = useCallback(async () => {
    try {
      const s = await sessions.listSessions();
      setSessionList(s);
    } catch (e) {
      console.error("[dashboard] refreshData failed:", e);
    }
  }, []);

  /* --- Auth check --- */
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
  }, [router]);

  /* --- Load data once auth + DuckDB are ready --- */
  useEffect(() => {
    if (!session || !duckdbReady) return;
    refreshData();
  }, [session, duckdbReady, refreshData]);

  async function fetchAccount(token: string) {
    try {
      const res = await fetch(`${API}/account`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPlan(data.plan);
      }
    } catch (e) {
      console.error("[dashboard] fetchAccount failed:", e);
    }
  }

  function handleNewSession() {
    setNewSessionName("");
    setPendingFiles([]);
    setModalDragging(false);
    modalDragCounter.current = 0;
    if (modalFileRef.current) modalFileRef.current.value = "";
    setShowNewSessionModal(true);
  }

  function handleModalFiles(files: FileList | null) {
    if (!files) return;
    const validExts = ["csv", "tsv", "parquet"];
    const newFiles: { file: File; name: string }[] = [];
    for (const f of Array.from(files)) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (validExts.includes(ext)) newFiles.push({ file: f, name: f.name });
    }
    if (newFiles.length > 0) {
      setPendingFiles((prev) => [...prev, ...newFiles]);
    }
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCreateSession() {
    if (!session || creatingSession) return;
    setCreatingSession(true);
    try {
      const name = newSessionName.trim() || "Untitled session";
      const datasetIds: string[] = [];
      for (const pf of pendingFiles) {
        const bytes = new Uint8Array(await pf.file.arrayBuffer());
        const ds = await datasets.createDataset(pf.name, bytes);
        datasetIds.push(ds.id);
      }
      const sid = await sessions.createSession(name, datasetIds);
      router.push(`/sessions/${sid}`);
      // Keep modal open with "Creating..." state — navigation will unmount it
    } catch (e) {
      console.error("[dashboard] handleCreateSession failed:", e);
      setCreatingSession(false);
      setShowNewSessionModal(false);
    }
  }

  async function handleDeleteSession(e: React.MouseEvent, sessionId: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!session) return;
    setDeletingSessionId(sessionId);
    try {
      await sessions.deleteSession(sessionId);
      await refreshData();
    } catch (e) {
      console.error("[dashboard] handleDeleteSession failed:", e);
    }
    setDeletingSessionId(null);
  }

  async function handleLogout() {
    await flushCheckpoint();
    await supabase.auth.signOut();
    router.push("/login");
  }

  async function handleClearData() {
    if (!confirm("Clear all local data? This will delete all datasets, sessions, and cached data. This cannot be undone.")) return;
    try {
      const { clearAllData } = await import("@/lib/duckdb");
      await clearAllData();
      window.location.reload();
    } catch {
      window.location.reload();
    }
  }

  /* --- Loading skeleton --- */
  if (authLoading) {
    return (
      <div className="h-screen flex flex-col bg-surface">
        {/* Nav skeleton */}
        <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg animate-shimmer" />
                <div className="h-5 w-16 rounded animate-shimmer" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded animate-shimmer" />
              <div className="h-[22px] w-11 rounded-full animate-shimmer" />
              <div className="h-4 w-4 rounded animate-shimmer" />
            </div>
          </div>
        </nav>
        <div className="flex-1 overflow-auto px-6 py-8">
          <div className="max-w-7xl mx-auto">
            {/* Welcome skeleton */}
            <div className="mb-6">
              <div className="h-9 w-64 rounded animate-shimmer mb-1.5" />
              <div className="h-4 w-40 rounded animate-shimmer" />
            </div>
            {/* Controls skeleton */}
            <div className="flex items-center gap-3 mb-5">
              <div className="h-9 w-56 rounded-lg animate-shimmer" />
              <div className="h-9 w-24 rounded-lg animate-shimmer" />
            </div>
            <GridSkeleton />
          </div>
        </div>
      </div>
    );
  }

  const hasSearch = search.trim().length > 0;
  const noResults = filteredSessions !== null && filteredSessions.length === 0 && hasSearch;
  const isEmpty = sessionList !== null && sessionList.length === 0;

  return (
    <div className="h-screen flex flex-col bg-surface overflow-hidden relative">
      {/* Nav */}
      <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2.5 cursor-pointer">
              <Image
                src="/logo.png"
                alt="Kwartz"
                width={32}
                height={32}
              />
              <span className="text-2xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight text-text">
                Kwartz
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              )}
            </button>
            <Link
              href="/plans"
              className={`text-xs font-medium rounded-full px-2.5 py-1 border inline-flex items-center transition-colors cursor-pointer ${
                plan === "pro"
                  ? "pro-badge"
                  : "border-border bg-surface-alt text-text-secondary hover:border-accent/40"
              }`}
            >
              {plan !== null ? (
                plan === "pro" ? "Pro" : "Free"
              ) : (
                <span className="inline-block h-3 w-7 rounded animate-shimmer" />
              )}
            </Link>
            <SettingsMenu email={session?.user?.email ?? ""} onLogout={handleLogout} onClearData={handleClearData} />
          </div>
        </div>
      </nav>

      {/* Storage quota warning banner */}
      {storageWarning && (
        <div className="shrink-0 flex items-center gap-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-6 py-2 text-xs">
          <span>{storageWarning}</span>
          <button
            onClick={() => setStorageWarning(null)}
            className="ml-auto text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Main scrollable area */}
      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="max-w-7xl mx-auto">

          {/* Welcome header + controls */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="relative mb-6"
          >
            {/* Subtle radial glow */}
            <div className="absolute -top-20 left-1/4 -translate-x-1/2 w-[500px] h-[250px] bg-[radial-gradient(ellipse,rgba(99,102,241,0.06)_0%,rgba(167,139,250,0.03)_40%,transparent_70%)] pointer-events-none" />
            <h1
              className="relative text-3xl sm:text-4xl font-[family-name:var(--font-clash)] tracking-tight text-text"
              style={{ fontWeight: "var(--clash-weight)" } as React.CSSProperties}
            >
              Welcome back
            </h1>
            <p className="relative mt-1 text-sm text-text-muted">
              {session?.user?.email}
            </p>
          </motion.div>

          {/* Search + Sort row */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.08 }}
            className="flex items-center gap-3 mb-5"
          >
            {/* Search input */}
            <div className="relative flex-1 max-w-xs">
              <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sessions..."
                className="w-full bg-surface border border-border rounded-lg pl-10 pr-4 py-2 text-sm text-text placeholder:text-text-muted outline-none focus:border-accent transition-colors"
              />
            </div>

            <SortDropdown
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={handleSort}
            />
          </motion.div>

          {/* Content area */}
          {sessionList === null ? (
            /* Loading skeleton */
            <GridSkeleton />
          ) : isEmpty ? (
            /* Empty state */
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="relative flex flex-col items-center justify-center py-28 text-center"
            >
              {/* Background glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[300px] bg-[radial-gradient(ellipse,rgba(99,102,241,0.06)_0%,transparent_70%)] pointer-events-none" />
              <div className="relative mx-auto w-20 h-20 rounded-2xl bg-accent-light flex items-center justify-center mb-6">
                <svg className="w-9 h-9 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                </svg>
              </div>
              <h2
                className="relative text-2xl font-[family-name:var(--font-clash)] tracking-tight text-text mb-2"
                style={{ fontWeight: "var(--clash-weight)" } as React.CSSProperties}
              >
                No sessions yet
              </h2>
              <p className="relative text-sm text-text-muted mb-7 max-w-sm">
                Sessions are your workspace for analyzing and transforming data with AI. Create one to get started.
              </p>
              <button
                onClick={handleNewSession}
                className="relative inline-flex items-center gap-2 py-3 px-7 rounded-xl text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-all shadow-lg shadow-indigo-500/20"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Create your first session
              </button>
            </motion.div>
          ) : noResults ? (
            /* Search no results */
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center justify-center py-24 text-center"
            >
              <div className="mx-auto w-14 h-14 rounded-2xl bg-surface-alt border border-border flex items-center justify-center mb-5">
                <svg className="w-6 h-6 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </div>
              <p className="text-base font-medium text-text mb-1.5">No matching sessions</p>
              <p className="text-sm text-text-muted">
                No sessions match &ldquo;{search.trim()}&rdquo;.{" "}
                <button onClick={() => setSearch("")} className="text-accent hover:underline">
                  Clear search
                </button>
              </p>
            </motion.div>
          ) : (
            /* Session cards grid */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* New session card */}
              <motion.button
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.18 }}
                whileHover={{ y: -2, transition: { type: "spring", stiffness: 400, damping: 25 } }}
                onClick={handleNewSession}
                className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-surface p-8 cursor-pointer hover:border-accent hover:bg-accent-light/30 transition-colors min-h-[160px]"
              >
                <div className="w-10 h-10 rounded-xl bg-accent-light flex items-center justify-center">
                  <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-text-muted">New session</span>
              </motion.button>

              {/* Session cards */}
              {filteredSessions!.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.22 + i * 0.05 }}
                  whileHover={navigatingTo ? undefined : { y: -2, transition: { type: "spring", stiffness: 400, damping: 25 } }}
                  onClick={() => { setNavigatingTo(s.id); router.push(`/sessions/${s.id}`); }}
                  className={`group relative rounded-2xl border bg-surface p-5 cursor-pointer hover:shadow-md transition-all min-h-[160px] flex flex-col ${
                    navigatingTo === s.id
                      ? "border-accent/50 opacity-75"
                      : navigatingTo
                        ? "opacity-50 pointer-events-none"
                        : "border-border hover:border-accent/30"
                  }`}
                >
                  {/* Delete button - top right, shown on hover */}
                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => handleDeleteSession(e, s.id)}
                      className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
                      title="Delete session"
                    >
                      {deletingSessionId === s.id ? (
                        <div className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      )}
                    </button>
                  </div>

                  {/* Loading spinner overlay when navigating to this session */}
                  {navigatingTo === s.id && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-surface/60 z-10">
                      <div className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                    </div>
                  )}

                  {/* Session name */}
                  <p className="text-base font-medium text-text group-hover:text-accent transition-colors pr-8 truncate mb-3">
                    {s.name}
                  </p>

                  {/* Dataset pills */}
                  <div className="flex flex-wrap gap-1.5 mb-auto">
                    {s.dataset_names.length > 0 ? (
                      <>
                        {s.dataset_names.slice(0, 3).map((name) => (
                          <span
                            key={name}
                            className="text-xs font-medium text-accent/70 bg-accent/[0.07] rounded-full px-2.5 py-0.5 truncate max-w-[140px]"
                          >
                            {name}
                          </span>
                        ))}
                        {s.dataset_names.length > 3 && (
                          <span className="text-xs font-medium text-text-muted bg-surface-alt rounded-full px-2.5 py-0.5">
                            +{s.dataset_names.length - 3} more
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-text-muted/50 italic">No datasets</span>
                    )}
                  </div>

                  {/* Footer: dataset count + time */}
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                    <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                      <svg className="w-3.5 h-3.5 text-emerald-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                      </svg>
                      {s.dataset_count} dataset{s.dataset_count !== 1 ? "s" : ""}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                      <svg className="w-3.5 h-3.5 text-amber-500/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {formatDate(s.updated_at)}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      <RuntimeToast status={runtimeStatus} progress={runtimeProgress} duckdbReady={duckdbReady} />

      {/* New Session Modal */}
      {showNewSessionModal && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowNewSessionModal(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-md mx-4"
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); modalDragCounter.current++; if (e.dataTransfer.types.includes("Files")) setModalDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); modalDragCounter.current--; if (modalDragCounter.current === 0) setModalDragging(false); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); modalDragCounter.current = 0; setModalDragging(false); handleModalFiles(e.dataTransfer.files); }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4">
              <h2 className="text-lg font-semibold text-text">New Session</h2>
              <button
                onClick={() => setShowNewSessionModal(false)}
                className="p-1 rounded-lg text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Name input */}
            <div className="px-6 pb-4">
              <label className="block text-xs font-medium text-text-muted mb-1.5">Name</label>
              <input
                type="text"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !creatingSession) handleCreateSession(); }}
                placeholder="Untitled session"
                className="w-full bg-surface-alt border border-border rounded-lg px-3.5 py-2 text-sm text-text placeholder:text-text-muted outline-none focus:border-accent transition-colors"
                autoFocus
              />
            </div>

            {/* Upload zone (optional) */}
            <div className="px-6 pb-4">
              <label className="block text-xs font-medium text-text-muted mb-1.5">Datasets <span className="text-text-muted/50 font-normal">— optional</span></label>
              <div
                className={`relative border border-dashed rounded-lg py-4 text-center transition-colors cursor-pointer ${
                  modalDragging
                    ? "border-accent bg-accent/5"
                    : "border-border hover:border-accent/40"
                }`}
                onClick={() => modalFileRef.current?.click()}
              >
                <p className="text-sm text-text-muted">
                  Drop files here, or{" "}
                  <span className="text-accent font-medium">browse</span>
                </p>
                <p className="text-xs text-text-muted/50 mt-0.5">CSV, TSV, or Parquet</p>
              </div>
              <input
                ref={modalFileRef}
                type="file"
                accept=".csv,.tsv,.parquet"
                multiple
                className="hidden"
                onChange={(e) => { handleModalFiles(e.target.files); if (modalFileRef.current) modalFileRef.current.value = ""; }}
              />
            </div>

            {/* File chips */}
            {pendingFiles.length > 0 && (
              <div className="px-6 pb-4 flex flex-wrap gap-2">
                {pendingFiles.map((pf, i) => (
                  <span
                    key={`${pf.name}-${i}`}
                    className="inline-flex items-center gap-1.5 bg-surface-alt rounded-full px-3 py-1 text-xs font-medium text-text max-w-[200px]"
                  >
                    <span className="truncate">{pf.name}</span>
                    <button
                      onClick={() => removePendingFile(i)}
                      className="shrink-0 p-0.5 rounded-full text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between px-6 pb-6 pt-2">
              <button
                onClick={() => setShowNewSessionModal(false)}
                className="py-2 px-4 rounded-lg text-sm font-medium text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateSession}
                disabled={creatingSession}
                className="inline-flex items-center gap-2 py-2 px-5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
              >
                {creatingSession ? (
                  <>
                    <div className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    Creating...
                  </>
                ) : pendingFiles.length > 0 ? (
                  `Create with ${pendingFiles.length} file${pendingFiles.length !== 1 ? "s" : ""}`
                ) : (
                  "Create"
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="h-screen flex flex-col bg-surface">
          <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-lg animate-shimmer" />
                  <div className="h-5 w-16 rounded animate-shimmer" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-4 w-4 rounded animate-shimmer" />
                <div className="h-[22px] w-11 rounded-full animate-shimmer" />
                <div className="h-4 w-4 rounded animate-shimmer" />
              </div>
            </div>
          </nav>
          <div className="flex-1 overflow-auto px-6 py-8">
            <div className="max-w-7xl mx-auto">
              <div className="mb-6">
                <div className="h-9 w-64 rounded animate-shimmer mb-1.5" />
                <div className="h-4 w-40 rounded animate-shimmer" />
              </div>
              <div className="flex items-center gap-3 mb-5">
                <div className="h-9 w-56 rounded-lg animate-shimmer" />
                <div className="h-9 w-24 rounded-lg animate-shimmer" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            </div>
          </div>
        </div>
      }
    >
      <DashboardContent />
    </Suspense>
  );
}
