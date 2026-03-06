"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

export interface UsageInfo {
  credits_used: number;
  credits_limit: number;
  period_start: string;
}

interface SettingsMenuProps {
  email: string;
  onLogout: () => void;
  onClearData?: () => void;
  plan?: string;
  usage?: UsageInfo | null;
}

function daysUntilReset(periodStart: string): number {
  const start = new Date(periodStart);
  const reset = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const now = new Date();
  return Math.max(0, Math.ceil((reset.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

export default function SettingsMenu({ email, onLogout, onClearData, plan, usage }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function handleMouseEnter() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  }

  function handleMouseLeave() {
    timeoutRef.current = setTimeout(() => setOpen(false), 150);
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const pct = usage ? Math.min(100, (usage.credits_used / usage.credits_limit) * 100) : 0;
  const remaining = usage ? Math.max(0, usage.credits_limit - usage.credits_used) : 0;
  const resetDays = usage ? daysUntilReset(usage.period_start) : 0;

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
        title="Settings"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg z-50 py-1">
          <div className="px-3.5 py-2.5 text-xs text-text-muted truncate border-b border-border">
            {email}
          </div>

          {usage && (
            <div className="px-3.5 py-2.5 border-b border-border space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-text-muted">Weekly credits</span>
                <span className="text-text tabular-nums">{remaining} left</span>
              </div>
              <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-accent"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="text-[10px] text-text-muted">
                {usage.credits_used}/{usage.credits_limit} used &middot; resets in {resetDays}d
              </div>
            </div>
          )}

          <Link
            href="/plans"
            className="block px-3.5 py-2 text-sm text-text hover:bg-surface-alt transition-colors"
          >
            Subscription
          </Link>
          <Link
            href="/feedback"
            className="block px-3.5 py-2 text-sm text-text hover:bg-surface-alt transition-colors"
          >
            Send Feedback
          </Link>
          {onClearData && (
            <button
              onClick={onClearData}
              className="w-full text-left px-3.5 py-2 text-sm text-red-500 hover:bg-surface-alt transition-colors cursor-pointer"
            >
              Clear all data
            </button>
          )}
          <div className="border-t border-border my-1" />
          <Link
            href="/terms"
            className="block px-3.5 py-2 text-sm text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
          >
            Terms of Service
          </Link>
          <Link
            href="/privacy"
            className="block px-3.5 py-2 text-sm text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
          >
            Privacy Policy
          </Link>
          <div className="border-t border-border my-1" />
          <button
            onClick={onLogout}
            className="w-full text-left px-3.5 py-2 text-sm text-text-muted hover:text-text hover:bg-surface-alt transition-colors cursor-pointer"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
