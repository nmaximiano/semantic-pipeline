"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/useTheme";
import SettingsMenu from "@/components/SettingsMenu";
import type { Session } from "@supabase/supabase-js";
import { API } from "@/lib/api";
import { flushCheckpoint } from "@/lib/duckdb";

const CONFETTI_COLORS = ["#6366f1", "#a78bfa", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#f43f5e"];

function ConfettiBlast() {
  const pieces = useMemo(() => {
    return Array.from({ length: 40 }, (_, i) => {
      const angle = (i / 40) * 360 + (Math.random() * 20 - 10);
      const rad = (angle * Math.PI) / 180;
      const dist = 120 + Math.random() * 180;
      return {
        id: i,
        cx: `${Math.cos(rad) * dist}px`,
        cy: `${Math.sin(rad) * dist - 60}px`,
        cr: `${Math.random() * 720 - 360}deg`,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: `${Math.random() * 0.3}s`,
        width: 4 + Math.random() * 6,
        height: 4 + Math.random() * 6,
        radius: Math.random() > 0.5 ? "50%" : "2px",
      };
    });
  }, []);

  return (
    <div className="confetti-container">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            "--cx": p.cx,
            "--cy": p.cy,
            "--cr": p.cr,
            backgroundColor: p.color,
            animationDelay: p.delay,
            width: p.width,
            height: p.height,
            borderRadius: p.radius,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

export default function SubscriptionSuccess() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const { theme, toggle: toggleTheme } = useTheme();

  async function handleLogout() {
    await flushCheckpoint();
    await supabase.auth.signOut();
    router.push("/login");
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.push("/login");
        return;
      }
      setSession(session);
      setAuthLoading(false);
      pollForPro(session.access_token);
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

  // Poll account a few times to confirm webhook processed the upgrade
  function pollForPro(token: string) {
    const attempts = [1000, 3000, 6000, 10000];
    const timeouts = attempts.map((delay) =>
      setTimeout(async () => {
        try {
          const res = await fetch(`${API}/account`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            if (data.plan === "pro") setConfirmed(true);
          }
        } catch (e) {
          console.error("[plans/success] pollForPro failed:", e);
        }
      }, delay)
    );
    return () => timeouts.forEach(clearTimeout);
  }

  if (authLoading) {
    return (
      <div className="h-screen flex flex-col overflow-hidden">
        <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
          <div className="flex items-center justify-between">
            <Link href="/dashboard" className="flex items-center gap-2.5">
              <Image src="/logo.png" alt="Kwartz" width={32} height={32} />
              <span className="text-2xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight text-text">
                Kwartz
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
              <Link href="/dashboard" className="bg-accent text-white text-xs font-medium px-4 py-1.5 rounded-lg hover:bg-accent-hover transition-colors">
                Dashboard
              </Link>
              <SettingsMenu email="" onLogout={handleLogout} />
            </div>
          </div>
        </nav>
        <div className="flex-1 flex items-center justify-center bg-surface-alt">
          <div className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-2.5">
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

      <main className="flex-1 flex items-center justify-center bg-surface-alt px-4 relative overflow-hidden">
        <div className="w-full max-w-sm relative">
          <ConfettiBlast />
          <div className="animate-in rounded-2xl bg-surface shadow-sm p-8 text-center relative overflow-hidden rainbow-glow-card border-transparent">
            <svg
              className="w-10 h-10 text-accent mx-auto mb-5"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M5 16L3 5l5.5 5L12 4l3.5 6L21 5l-2 11H5zm14 3c0 .6-.4 1-1 1H6c-.6 0-1-.4-1-1v-1h14v1z" />
            </svg>

            <h1 className="text-xl font-semibold text-text">
              Welcome to Pro!
            </h1>
            <p className="mt-2 text-sm text-text-muted">
              Your subscription is active. You now have access to all Pro features.
            </p>

            {confirmed ? (
              <p className="mt-4 text-sm">
                <span className="inline-flex items-center gap-1.5 font-medium text-accent">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Pro plan confirmed
                </span>
              </p>
            ) : (
              <p className="mt-4 text-sm text-text-muted">
                Confirming upgrade...
              </p>
            )}

            <div className="flex flex-col gap-3 mt-6">
              <Link
                href="/dashboard"
                className="w-full bg-accent text-white py-3 px-6 rounded-xl text-sm font-medium hover:bg-accent-hover transition-colors inline-block"
              >
                Go to dashboard
              </Link>
              <Link
                href="/plans"
                className="w-full py-3 px-6 rounded-xl text-sm font-medium border border-border text-text-secondary hover:bg-surface-hover transition-colors inline-block"
              >
                View plan details
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
