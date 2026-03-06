"use client";

import { useState, useEffect } from "react";

export function PlanCard({ steps, isActive }: { steps: string[]; isActive: boolean }) {
  const [expanded, setExpanded] = useState(true);

  // Auto-collapse when the agent finishes (isActive goes false)
  useEffect(() => {
    if (!isActive) setExpanded(false);
  }, [isActive]);

  return (
    <div
      className={`rounded-lg border overflow-hidden ${
        isActive
          ? "border-accent/40 border-l-2 border-l-accent bg-accent/5"
          : "border-border bg-surface-alt/50"
      }`}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium text-text hover:bg-surface-hover transition-colors"
      >
        <svg
          className={`w-3 h-3 text-text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span>Plan ({steps.length} steps)</span>
      </button>
      {expanded && (
        <div className="px-3.5 pb-2.5 space-y-1">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2.5 text-[13px]">
              <span className="shrink-0 w-5 h-5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold flex items-center justify-center mt-px">
                {i + 1}
              </span>
              <span className="text-text pt-0.5">{step}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
