"use client";

import { useState } from "react";
import type { StoredPlot } from "@/lib/usePlotStore";
import { PlotLightbox } from "./PlotLightbox";

interface PlotPanelProps {
  plots: StoredPlot[];
  onClear: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function PlotPanel({ plots, onClear }: PlotPanelProps) {
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
          <div key={plot.id} className="rounded-lg border border-border overflow-hidden bg-white">
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
