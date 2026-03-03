"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/useTheme";
import Link from "next/link";

export default function WaitlistPage() {
  const [email, setEmail] = useState<string | null>(null);
  const { theme, toggle: toggleTheme } = useTheme();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
    });
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-surface">
      <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="text-2xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight">
              <span className="text-accent font-bold">R</span>
              <span className="text-text">·Base</span>
            </span>
          </Link>
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
            <button
              onClick={handleLogout}
              className="text-sm text-text-muted hover:text-text transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center">
            <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>

          <h1
            className="text-3xl font-[family-name:var(--font-clash)] tracking-tight text-text mb-3"
            style={{ fontWeight: "var(--clash-weight)" } as React.CSSProperties}
          >
            You&apos;re on the waitlist
          </h1>

          <p className="text-text-muted mb-2">
            Thanks for signing up{email ? (
              <>, <span className="font-medium text-text">{email}</span></>
            ) : null}.
          </p>
          <p className="text-text-muted mb-8">
            R·Base is currently in private beta. We&apos;ll email you when your
            access is ready.
          </p>

          <div className="rounded-2xl border border-border bg-surface-alt p-6 text-left space-y-4">
            <p className="text-sm font-medium text-text">What is R·Base?</p>
            <ul className="space-y-2.5 text-sm text-text-muted">
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-accent/15 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                </span>
                Run R code directly in your browser — no installation needed
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-accent/15 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                </span>
                Upload datasets and analyze them with an AI agent
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-accent/15 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                </span>
                Generate ggplot2 visualizations with a single prompt
              </li>
            </ul>
          </div>

          <p className="mt-6 text-xs text-text-muted/60">
            Questions? Email us at{" "}
            <a href="mailto:support@tryrbase.com" className="underline underline-offset-2 hover:text-text-muted transition-colors">
              support@tryrbase.com
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}
