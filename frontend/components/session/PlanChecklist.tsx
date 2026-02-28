"use client";

import { useState } from "react";
import type { PlanStepData } from "@/lib/session-types";

export function PlanChecklist({ steps }: { steps: PlanStepData[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const doneCount = steps.filter((s) => s.status === "done").length;
  const totalCount = steps.length;
  const allDone = doneCount === totalCount;

  return (
    <div className="rounded-lg border border-border bg-surface-alt/50 overflow-hidden">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium text-text hover:bg-surface-hover transition-colors"
      >
        <svg
          className={`w-3 h-3 text-text-muted transition-transform ${collapsed ? "" : "rotate-90"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {allDone ? (
          <svg className="w-3.5 h-3.5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        ) : (
          <div className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-accent border-t-transparent animate-spin" />
        )}
        <span>
          Plan {allDone ? "completed" : "in progress"} ({doneCount}/{totalCount})
        </span>
      </button>
      {!collapsed && (
        <div className="px-3.5 pb-2.5 space-y-1">
          {steps.map((step) => (
            <div key={step.id} className="flex items-start gap-2 text-[13px]">
              {step.status === "done" ? (
                <svg className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : step.status === "skipped" ? (
                <svg className="w-3.5 h-3.5 text-text-muted shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062A1.125 1.125 0 013 16.81V8.69zM12.75 8.689c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062a1.125 1.125 0 01-1.683-.977V8.69z" />
                </svg>
              ) : (
                <div className="w-3.5 h-3.5 shrink-0 mt-0.5 rounded-full border border-border" />
              )}
              <span className={step.status === "skipped" ? "line-through text-text-muted" : "text-text"}>
                {step.description}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
