"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

import Link from "next/link";
import { motion } from "motion/react";
import { useTheme } from "@/lib/useTheme";

export default function ResetPasswordConfirmPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const { theme, toggle: toggleTheme } = useTheme();

  // Verify the user has a valid session (from the recovery email link)
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSuccess(true);
      // Redirect to dashboard after a short delay
      setTimeout(() => router.push("/dashboard"), 2000);
    } catch (e: any) {
      setError(e.message || "Failed to update password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="text-3xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight">
              <span className="text-accent font-bold">R</span><span className="text-text">·Base</span>
            </span>
          </Link>
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
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center bg-surface px-4 relative overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="w-full max-w-sm relative"
        >
          <div className="text-center mb-8">
            <h1
              className="text-3xl font-[family-name:var(--font-clash)] tracking-tight text-text"
              style={{ fontWeight: "var(--clash-weight)" } as React.CSSProperties}
            >
              Set new password
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              Choose a new password for your account
            </p>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="rounded-2xl border border-border bg-surface shadow-lg shadow-black/[0.03] dark:shadow-black/20 p-7"
          >
            {error && (
              <div className="mb-5 flex items-center gap-3 bg-error-bg border border-error-border text-error rounded-xl px-4 py-3 text-sm">
                <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {hasSession === null ? (
              // Loading — checking session
              <div className="flex items-center justify-center py-8">
                <span className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              </div>
            ) : hasSession === false ? (
              // No session — invalid or expired link
              <div className="text-center py-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-error-bg flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-text mb-1">Invalid or expired link</p>
                <p className="text-sm text-text-muted mb-4">
                  This reset link is no longer valid. Please request a new one.
                </p>
                <Link
                  href="/reset-password"
                  className="inline-block bg-accent text-white py-2 px-5 rounded-lg text-sm font-medium hover:bg-accent-hover transition-colors"
                >
                  Request new link
                </Link>
              </div>
            ) : success ? (
              // Success
              <div className="text-center py-4">
                <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-text mb-1">Password updated</p>
                <p className="text-sm text-text-muted">
                  Redirecting to dashboard...
                </p>
              </div>
            ) : (
              // Password form
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1.5">New password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    autoFocus
                    className="w-full border border-border rounded-lg px-3.5 py-2 text-sm text-text bg-surface-alt placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1.5">Confirm password</label>
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full border border-border rounded-lg px-3.5 py-2 text-sm text-text bg-surface-alt placeholder:text-text-muted/50 focus:outline-none focus:border-accent transition-colors"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-accent text-white py-2.5 px-6 rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm shadow-accent/20"
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-current border-t-transparent animate-spin" />
                      Updating...
                    </span>
                  ) : (
                    "Update password"
                  )}
                </button>
              </form>
            )}
          </motion.div>
        </motion.div>
      </main>
    </div>
  );
}
