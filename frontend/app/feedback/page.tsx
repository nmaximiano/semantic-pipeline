"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/useTheme";
import SettingsMenu from "@/components/SettingsMenu";
import type { Session } from "@supabase/supabase-js";
import { API, getAccessToken } from "@/lib/api";
import { flushCheckpoint } from "@/lib/duckdb";

export default function FeedbackPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const { theme, toggle: toggleTheme } = useTheme();

  const [category, setCategory] = useState<"bug" | "feature" | "general">("general");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

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
      console.error("[feedback] fetchAccount failed:", e);
    }
  }

  async function handleSubmit() {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API}/feedback`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category,
          message: message.trim(),
          page_url: "/feedback",
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to submit");
      }
      setMessage("");
      setCategory("general");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: any) {
      setError(e.message || "Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    await flushCheckpoint();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (authLoading || plan === null) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
          <div className="flex items-center justify-between">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <span className="text-3xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight">
                <span className="text-accent font-bold">R</span><span className="text-text">·Base</span>
              </span>
            </Link>
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded animate-shimmer" />
              <div className="h-[22px] w-11 rounded-full animate-shimmer" />
              <div className="h-4 w-4 rounded animate-shimmer" />
            </div>
          </div>
        </nav>
        <main className="flex-1 overflow-auto bg-surface-alt flex items-center justify-center">
          <div className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </main>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2.5 cursor-pointer">
              <span className="text-3xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight">
                <span className="text-accent font-bold">R</span><span className="text-text">·Base</span>
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
              href="/dashboard"
              className="bg-accent text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
            >
              Dashboard
            </Link>
            <SettingsMenu email={session?.user?.email ?? ""} onLogout={handleLogout} plan={plan} />
          </div>
        </div>
      </nav>

      <main className="flex-1 overflow-auto bg-surface-alt flex items-center justify-center">
        <div className="w-full max-w-lg mx-auto px-6 py-12">
          <div className="text-center mb-8">
            <h1
              className="text-3xl font-[family-name:var(--font-clash)] tracking-tight text-text"
              style={{ fontWeight: "var(--clash-weight)" } as React.CSSProperties}
            >
              Send Feedback
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              Help us shape R·Base. Bug reports, feature ideas, or anything else.
            </p>
          </div>

          <div className="bg-surface border border-border rounded-2xl p-6 space-y-5">
            {/* Category */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-2">Category</label>
              <div className="flex gap-2">
                {(["bug", "feature", "general"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`text-sm font-medium px-4 py-2 rounded-lg border transition-colors capitalize ${
                      category === c
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-border text-text-muted hover:text-text hover:bg-surface-alt"
                    }`}
                  >
                    {c === "bug" ? "Bug Report" : c === "feature" ? "Feature Request" : "General"}
                  </button>
                ))}
              </div>
            </div>

            {/* Message */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-2">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={
                  category === "bug"
                    ? "Describe the bug. What happened, and what did you expect?"
                    : category === "feature"
                      ? "Describe the feature you'd like to see..."
                      : "What's on your mind?"
                }
                rows={5}
                className="w-full bg-surface-alt border border-border rounded-lg px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted outline-none focus:border-accent/50 transition-colors resize-none"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-error">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="flex items-center gap-2 text-sm text-accent">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span>Thanks for your feedback!</span>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!message.trim() || submitting}
              className="w-full py-2.5 rounded-xl text-sm font-medium bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {submitting ? "Sending..." : "Submit feedback"}
            </button>
          </div>
        </div>
      </main>

    </div>
  );
}
