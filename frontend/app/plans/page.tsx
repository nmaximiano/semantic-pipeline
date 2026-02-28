"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/useTheme";
import SettingsMenu from "@/components/SettingsMenu";
import type { Session } from "@supabase/supabase-js";
import { API, getAccessToken } from "@/lib/api";
import { flushCheckpoint } from "@/lib/duckdb";

interface AccountInfo {
  plan: string;
  email: string;
  credits_used: number;
  credits_limit: number;
  transform_rows_used: number;
  transform_rows_limit: number;
  max_datasets: number | null;
  max_rows_per_dataset: number;
  max_storage_bytes: number;
  period_start: string;
}

export default function CreditsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [managingBilling, setManagingBilling] = useState(false);
  const [error, setError] = useState("");
  const { theme, toggle: toggleTheme } = useTheme();

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
        setAccount(data);
      }
    } catch (e) {
      console.error("[plans] fetchAccount failed:", e);
    }
  }

  async function handleUpgrade() {
    if (!session) return;
    setError("");
    setUpgrading(true);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API}/create-checkout-session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      window.location.href = data.url;
    } catch (e: any) {
      setError(e.message || "Failed to start checkout");
      setUpgrading(false);
    }
  }

  async function handleManageBilling() {
    if (!session) return;
    setError("");
    setManagingBilling(true);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API}/create-portal-session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      window.location.href = data.url;
    } catch (e: any) {
      setError(e.message || "Failed to open billing portal");
      setManagingBilling(false);
    }
  }

  async function handleLogout() {
    await flushCheckpoint();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (authLoading || !account) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/dashboard" className="flex items-center gap-2.5 cursor-pointer">
                <Image src="/logo.png" alt="Kwartz" width={32} height={32} />
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
              <Link href="/dashboard" className="bg-accent text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-accent-hover transition-colors">
                Dashboard
              </Link>
              <SettingsMenu email="" onLogout={() => {}} />
            </div>
          </div>
        </nav>
        <main className="flex-1 overflow-auto bg-surface-alt flex items-center justify-center">
          <div className="max-w-4xl w-full mx-auto px-6 py-12">
            {/* Plan cards skeleton */}
            <div className="grid md:grid-cols-2 gap-8">
              {/* Free card skeleton */}
              <div className="rounded-2xl border border-border bg-surface p-9 flex flex-col">
                <div className="mb-7">
                  <div className="h-4 w-10 rounded animate-shimmer" />
                  <div className="mt-4 h-12 w-16 rounded animate-shimmer" />
                </div>
                <div className="space-y-4 flex-1">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center justify-between py-2">
                      <div className="h-4 w-28 rounded animate-shimmer" />
                      <div className="h-4 w-16 rounded animate-shimmer" />
                    </div>
                  ))}
                </div>
                <div className="mt-8 h-12 w-full rounded-xl animate-shimmer" />
              </div>
              {/* Pro card skeleton */}
              <div className="rounded-2xl border border-border bg-surface p-9 flex flex-col">
                <div className="mb-7">
                  <div className="h-4 w-8 rounded animate-shimmer" />
                  <div className="mt-4 h-12 w-16 rounded animate-shimmer" />
                </div>
                <div className="space-y-4 flex-1">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center justify-between py-2">
                      <div className="h-4 w-28 rounded animate-shimmer" />
                      <div className="h-4 w-16 rounded animate-shimmer" />
                    </div>
                  ))}
                  <div className="pt-3 border-t border-border">
                    <div className="h-4 w-28 rounded animate-shimmer" />
                    <div className="h-3.5 w-52 rounded animate-shimmer mt-2" />
                  </div>
                </div>
                <div className="mt-8 h-12 w-full rounded-xl animate-shimmer" />
              </div>
            </div>
            <div className="h-4 w-64 rounded animate-shimmer mx-auto mt-7" />
          </div>
        </main>
      </div>
    );
  }

  const isPro = account?.plan === "pro";

  return (
    <div className="h-screen flex flex-col overflow-hidden">
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
              href="/dashboard"
              className="bg-accent text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
            >
              Dashboard
            </Link>
            <SettingsMenu email={session?.user?.email ?? ""} onLogout={handleLogout} />
          </div>
        </div>
      </nav>

      <main className="flex-1 overflow-auto bg-surface-alt relative flex items-center justify-center">
        <div className="max-w-4xl mx-auto px-6 py-12 relative">
          {/* Error banner */}
          {error && (
            <div className="mb-6 flex items-center gap-3 bg-error-bg border border-error-border text-error rounded-xl px-4 py-3 text-sm max-w-lg mx-auto">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Side-by-side plan cards */}
          <div className="grid md:grid-cols-2 gap-8">
            {/* Free card */}
            <div
              className={`rounded-2xl border bg-surface p-9 flex flex-col relative overflow-hidden transition-shadow ${
                !isPro
                  ? "border-accent/50 shadow-md shadow-accent/5"
                  : "border-border"
              }`}
            >
              {!isPro && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent/40" />
              )}

              <div className="mb-7">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-text-secondary uppercase tracking-wider">
                    Free
                  </span>
                  {!isPro && (
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-accent bg-accent/10 rounded-full px-2.5 py-0.5">
                      Current plan
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-5xl font-bold text-text tracking-tight">$0</span>
                  <span className="text-base text-text-muted">/month</span>
                </div>
              </div>

              <div className="space-y-4 flex-1">
                <FeatureRow label="Messages" value="50 / week" />
                <FeatureRow label="Datasets" value="5" />
                <FeatureRow label="Rows per dataset" value="100K" />
                <FeatureRow label="Storage" value="50 MB" />
              </div>

              {isPro ? (
                <div className="mt-8 w-full py-3 rounded-xl text-base font-medium text-center text-text-muted border border-border">
                  Free tier
                </div>
              ) : (
                <Link
                  href="/dashboard"
                  className="mt-8 w-full py-3 rounded-xl text-base font-medium text-center border border-border text-text-secondary hover:bg-surface-hover transition-colors block"
                >
                  Go to dashboard
                </Link>
              )}
            </div>

            {/* Pro card */}
            <div
              className={`rounded-2xl bg-surface p-9 flex flex-col relative transition-shadow rainbow-glow-card ${
                isPro
                  ? "border border-accent/50 shadow-md shadow-accent/5"
                  : "border-transparent"
              }`}
            >
              <div className="mb-7">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-accent uppercase tracking-wider">
                    Pro
                  </span>
                  {isPro && (
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-accent bg-accent/10 rounded-full px-2.5 py-0.5">
                      Current plan
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-5xl font-bold text-text tracking-tight">$9</span>
                  <span className="text-base text-text-muted">/month</span>
                </div>
              </div>

              <div className="space-y-4 flex-1">
                <FeatureRow label="Messages" value="500 / week" highlight valueBold />
                <FeatureRow label="Datasets" value="Unlimited" highlight valueBold />
                <FeatureRow label="Rows per dataset" value="500K" highlight valueBold />
                <FeatureRow label="Storage" value="1 GB" highlight valueBold />
                <div className="pt-3 border-t border-border">
                  <span className="text-base font-semibold text-accent">LLM Transforms</span>
                  <p className="text-sm text-text-secondary mt-1">Generate, classify, and enrich columns with LLMs</p>
                </div>
              </div>

              {isPro ? (
                <button
                  onClick={handleManageBilling}
                  disabled={managingBilling}
                  className="mt-8 w-full py-3 rounded-xl text-base font-medium border border-border text-text-secondary hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {managingBilling
                    ? "Opening billing portal..."
                    : "Manage subscription"}
                </button>
              ) : (
                <button
                  onClick={handleUpgrade}
                  disabled={upgrading}
                  className="mt-8 w-full bg-accent text-white py-3 rounded-xl text-base font-medium hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {upgrading
                    ? "Redirecting to Stripe..."
                    : "Upgrade to Pro"}
                </button>
              )}
            </div>
          </div>

          <p className="text-sm text-text-muted text-center mt-7">
            Payments processed securely by Stripe &middot; Cancel anytime
          </p>
        </div>
      </main>
    </div>
  );
}

/* ─── Sub-components ─── */

function FeatureRow({
  label,
  value,
  highlight,
  valueBold,
  muted,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  valueBold?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-base whitespace-nowrap text-text-secondary">{label}</span>
      <span
        className={`text-base text-right ${valueBold ? "font-semibold" : "font-medium"} ${
          muted
            ? "text-text-muted"
            : highlight
              ? "text-accent"
              : "text-text"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
