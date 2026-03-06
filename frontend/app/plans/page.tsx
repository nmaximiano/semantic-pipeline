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

interface AccountInfo {
  plan: string;
  email: string;
  credits_used: number;
  credits_limit: number;
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

  async function handleUpgrade(targetPlan: "pro" | "max") {
    if (!session) return;
    setError("");
    setUpgrading(true);

    try {
      const token = await getAccessToken();
      const res = await fetch(`${API}/create-checkout-session`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan: targetPlan }),
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
              <Link href="/dashboard" className="bg-accent text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-accent-hover transition-colors">
                Dashboard
              </Link>
              <SettingsMenu email="" onLogout={() => {}} />
            </div>
          </div>
        </nav>
        <main className="flex-1 overflow-auto bg-surface-alt flex items-center justify-center">
          <div className="max-w-6xl w-full mx-auto px-6 py-12">
            {/* Plan cards skeleton */}
            <div className="grid md:grid-cols-3 gap-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-2xl border border-border bg-surface p-9 flex flex-col">
                  <div className="mb-7">
                    <div className="h-4 w-10 rounded animate-shimmer" />
                    <div className="mt-4 h-12 w-16 rounded animate-shimmer" />
                  </div>
                  <div className="space-y-4 flex-1">
                    {[0, 1, 2, 3].map((j) => (
                      <div key={j} className="flex items-center justify-between py-2">
                        <div className="h-4 w-28 rounded animate-shimmer" />
                        <div className="h-4 w-16 rounded animate-shimmer" />
                      </div>
                    ))}
                  </div>
                  <div className="mt-8 h-12 w-full rounded-xl animate-shimmer" />
                </div>
              ))}
            </div>
            <div className="h-4 w-64 rounded animate-shimmer mx-auto mt-7" />
          </div>
        </main>
      </div>
    );
  }

  const isPro = account?.plan === "pro";
  const isMax = account?.plan === "max";
  const hasProFeatures = isPro || isMax;

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
              href="/feedback"
              className="text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg shadow-sm shadow-accent/20"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              Give Feedback
            </Link>
            <Link
              href="/dashboard"
              className="bg-accent text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-accent-hover transition-colors"
            >
              Dashboard
            </Link>
            <SettingsMenu email={session?.user?.email ?? ""} onLogout={handleLogout} plan={account?.plan} />
          </div>
        </div>
      </nav>

      <main className="flex-1 overflow-auto bg-surface-alt relative flex items-center justify-center">
        <div className="max-w-6xl mx-auto px-6 py-12 relative">
          {/* Error banner */}
          {error && (
            <div className="mb-6 flex items-center gap-3 bg-error-bg border border-error-border text-error rounded-xl px-4 py-3 text-sm max-w-lg mx-auto">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Plan cards */}
          <div className="grid md:grid-cols-3 gap-6">
            {/* Free card */}
            <div
              className={`rounded-2xl border bg-surface p-9 flex flex-col relative overflow-hidden transition-shadow ${
                !hasProFeatures
                  ? "border-accent/50 shadow-md shadow-accent/5"
                  : "border-border"
              }`}
            >
              {!hasProFeatures && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent/40" />
              )}

              <div className="mb-7 min-h-[120px]">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-text-secondary uppercase tracking-wider">
                    Free
                  </span>
                  {!hasProFeatures && (
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
                <div className="pt-3 border-t border-border">
                  <span className="text-base font-semibold text-text-secondary">2 AI Models</span>
                  <p className="text-sm text-text-secondary mt-1">Basic models for simple tasks</p>
                </div>
              </div>

              {hasProFeatures ? (
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
              className={`rounded-2xl bg-surface p-9 flex flex-col relative transition-shadow border-transparent rainbow-glow-card`}
            >
              <div className="mb-7 min-h-[120px]">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium uppercase tracking-wider text-accent">
                    Pro
                  </span>
                  {isPro ? (
                    <span className="text-[11px] font-semibold uppercase tracking-wider rounded-full px-2.5 py-0.5 text-accent bg-accent/10">
                      Current plan
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold uppercase tracking-wider rounded-full px-2.5 py-0.5 text-white bg-accent">
                      Popular
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
                  <span className="text-base font-semibold text-accent">7 AI Models</span>
                  <p className="text-sm text-text-secondary mt-1">A wide selection of price-performance balanced models</p>
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
              ) : isMax ? (
                <div className="mt-8 w-full py-3 rounded-xl text-base font-medium text-center text-text-muted border border-border bg-surface-alt">
                  Included in Max
                </div>
              ) : (
                <button
                  onClick={() => handleUpgrade("pro")}
                  disabled={upgrading}
                  className="mt-8 w-full py-3 rounded-xl text-base font-medium bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {upgrading ? "Redirecting to checkout..." : "Upgrade to Pro"}
                </button>
              )}
            </div>

            {/* Max card */}
            <div
              className={`rounded-2xl bg-surface p-9 flex flex-col relative transition-shadow border-transparent orange-glow-card ${
                isMax ? "shadow-md shadow-orange-500/5" : ""
              }`}
            >
              <div className="mb-7 min-h-[120px]">
                <div className="flex items-center justify-between">
                  <span className={`text-base font-medium uppercase tracking-wider ${isMax ? "text-[var(--color-max)]" : "text-text-secondary"}`}>
                    Max
                  </span>
                  {isMax && (
                    <span className="text-[11px] font-semibold uppercase tracking-wider rounded-full px-2.5 py-0.5 text-[var(--color-max)] bg-[var(--color-max-bg)]">
                      Current plan
                    </span>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="text-5xl font-bold text-text tracking-tight">$19</span>
                  <span className="text-base text-text-muted">/month</span>
                </div>
                <p className="mt-2 text-sm font-medium text-[var(--color-max)]">200% value</p>
              </div>

              <div className="space-y-4 flex-1">
                <FeatureRow label="Messages" value="2,000 / week" highlight valueBold />
                <FeatureRow label="Datasets" value="Unlimited" highlight valueBold />
                <FeatureRow label="Rows per dataset" value="2M" highlight valueBold />
                <FeatureRow label="Storage" value="4 GB" highlight valueBold />
                <div className="pt-3 border-t border-border">
                  <span className="text-base font-semibold text-accent">All 11 AI Models</span>
                  <p className="text-sm text-text-secondary mt-1">The smartest and newest models including Claude Opus and GPT-5.4</p>
                </div>
              </div>

              {isMax ? (
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
                  onClick={() => handleUpgrade("max")}
                  disabled={upgrading}
                  className="mt-8 w-full py-3 rounded-xl text-base font-medium bg-[var(--color-max)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {upgrading ? "Redirecting to checkout..." : "Upgrade to Max"}
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
