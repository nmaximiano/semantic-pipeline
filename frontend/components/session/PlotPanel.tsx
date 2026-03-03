"use client";

import { useState } from "react";
import type { StoredPlot } from "@/lib/usePlotStore";
import { PlotLightbox } from "./PlotLightbox";

interface PlotPanelProps {
  plots: StoredPlot[];
  onClear: () => void;
  onDelete: (plotId: string) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function PlotPanel({ plots, onClear, onDelete }: PlotPanelProps) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  if (plots.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-xs text-text-muted text-center">
          No plots yet. Run a plotting command (e.g. ggplot) in the console or via the agent.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header with clear button */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] text-text-muted">{plots.length} plot{plots.length !== 1 ? "s" : ""}</span>
        <button
          onClick={onClear}
          className="text-[10px] text-text-muted hover:text-error transition-colors cursor-pointer"
        >
          Clear all
        </button>
      </div>

      {/* Plot gallery */}
      <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-3">
        {plots.map((plot) => (
          <div key={plot.id} className="group relative rounded-lg border border-border overflow-hidden bg-white">
            <button
              onClick={() => onDelete(plot.id)}
              className="absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer hover:bg-black/70"
              title="Delete plot"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img
              src={plot.dataUrl}
              alt="R plot"
              className="w-full cursor-zoom-in"
              draggable={false}
              onClick={() => setLightboxSrc(plot.dataUrl)}
            />
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-surface border-t border-border">
              <span
                className={`text-[10px] font-medium ${
                  plot.source === "user" ? "text-emerald-500" : "text-accent"
                }`}
              >
                {plot.source}
              </span>
              <span className="text-[10px] text-text-muted">{formatTime(plot.timestamp)}</span>
              {plot.code && (
                <span className="text-[10px] text-text-muted truncate ml-auto max-w-[120px] font-mono" title={plot.code}>
                  {plot.code}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {lightboxSrc && (
        <PlotLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
      )}
    </div>
  );
}
