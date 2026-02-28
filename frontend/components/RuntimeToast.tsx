"use client";

import { useState, useEffect, useRef } from "react";
import type { RuntimeStatus } from "@/lib/useRuntime";

type Phase = "hidden" | "visible" | "exiting";

interface RuntimeToastProps {
  status: RuntimeStatus;
  progress: string;
  duckdbReady: boolean;
}

export default function RuntimeToast({ status, progress, duckdbReady }: RuntimeToastProps) {
  // If runtime was already ready on mount, never show
  const skipRef = useRef(status === "ready");
  const [phase, setPhase] = useState<Phase>(skipRef.current ? "hidden" : "visible");

  // Transition to exiting once ready, then hidden after fade-out
  useEffect(() => {
    if (skipRef.current) return;
    if (status === "ready" && phase === "visible") {
      const t1 = setTimeout(() => setPhase("exiting"), 1500);
      return () => clearTimeout(t1);
    }
  }, [status, phase]);

  useEffect(() => {
    if (phase === "exiting") {
      const t2 = setTimeout(() => setPhase("hidden"), 500);
      return () => clearTimeout(t2);
    }
  }, [phase]);

  if (phase === "hidden") return null;

  const isError = status === "error";
  const isReady = status === "ready";

  return (
    <div
      className="fixed bottom-5 right-5 z-[90] transition-all duration-500 ease-out"
      style={{
        opacity: phase === "exiting" ? 0 : 1,
        transform: phase === "exiting" ? "translateX(20px)" : "translateX(0)",
      }}
    >
      <div className="bg-surface border border-border rounded-lg shadow-lg px-4 py-2.5 flex items-center gap-3 min-w-[220px]">
        {/* Icon */}
        {isError ? (
          <div className="h-4 w-4 shrink-0 text-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
        ) : isReady ? (
          <div className="h-4 w-4 shrink-0 text-green-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        ) : (
          <div className="h-4 w-4 shrink-0 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
        )}

        {/* Text */}
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm text-text leading-tight">
            {isReady ? "Ready" : isError ? "Runtime error" : progress}
          </span>
          {/* DuckDB checkmark while WebR still loading */}
          {!isReady && !isError && duckdbReady && (
            <span className="text-xs text-green-500 flex items-center gap-1">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              DuckDB ready
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
