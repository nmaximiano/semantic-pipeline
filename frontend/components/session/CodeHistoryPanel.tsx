"use client";

import { useState, useEffect } from "react";
import { getRCodeHistory, type RCodeEntry } from "@/lib/rCodeHistory";

interface CodeHistoryPanelProps {
  sessionId: string;
  refreshKey: number;
}

export function CodeHistoryPanel({ sessionId, refreshKey }: CodeHistoryPanelProps) {
  const [entries, setEntries] = useState<RCodeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRCodeHistory(sessionId).then((result) => {
      if (!cancelled) {
        setEntries(result);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [sessionId, refreshKey]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="h-4 w-4 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-xs text-text-muted text-center">
          No R code executed yet. Use the console or chat with the agent.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {entries.map((entry) => (
        <div key={entry.seq} className="border-b border-border/50 px-3 py-2">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                entry.source === "user" ? "bg-emerald-500" : "bg-accent"
              }`}
            />
            <span className="text-[10px] text-text-muted">
              {entry.source === "user" ? "Console" : "Agent"}
            </span>
            <span className="text-[10px] text-text-muted/50 ml-auto">#{entry.seq + 1}</span>
          </div>
          <pre className="text-[11px] font-mono text-text whitespace-pre-wrap break-all leading-snug">
            {entry.code}
          </pre>
        </div>
      ))}
    </div>
  );
}
