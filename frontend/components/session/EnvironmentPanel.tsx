"use client";

interface EnvEntry {
  stableId: string;
  rName: string;
  class: string;
  isDataFrame: boolean;
  nrow?: number;
  ncol?: number;
  length?: number;
}

interface EnvironmentPanelProps {
  entries: EnvEntry[];
  activeStableId: string | null;
  onObjectClick: (stableId: string) => void;
  envReady: boolean;
}

export function EnvironmentPanel({ entries, activeStableId, onObjectClick, envReady }: EnvironmentPanelProps) {
  if (entries.length === 0 && !envReady) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-xs text-text-muted text-center">Loading R environment...</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-xs text-text-muted text-center">
          No R objects in the environment. Upload a dataset or run R code in the console.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {entries.map((entry) => {
        const isActive = entry.stableId === activeStableId;
        return (
          <button
            key={entry.stableId}
            onClick={() => onObjectClick(entry.stableId)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors cursor-pointer ${
              isActive
                ? "bg-accent/10 text-accent"
                : "text-text hover:bg-surface-hover"
            }`}
          >
            {/* Type icon */}
            {entry.isDataFrame ? (
              <svg className="w-3.5 h-3.5 shrink-0 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 shrink-0 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <circle cx="12" cy="12" r="9" />
              </svg>
            )}

            {/* Name + metadata */}
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium truncate block">{entry.rName}</span>
            </div>

            {/* Class badge */}
            <span className="shrink-0 text-[10px] text-text-muted bg-surface-alt rounded px-1.5 py-0.5">
              {entry.class}
            </span>

            {/* Dimensions */}
            <span className="shrink-0 text-[10px] text-text-muted tabular-nums">
              {entry.isDataFrame && entry.nrow !== undefined && entry.ncol !== undefined
                ? `${entry.nrow} x ${entry.ncol}`
                : entry.length !== undefined
                  ? `len ${entry.length}`
                  : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}
