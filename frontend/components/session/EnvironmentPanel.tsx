"use client";

import { useState, useRef, useEffect } from "react";

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
  onRunCode: (code: string) => Promise<void>;
  onRefreshEnv: () => Promise<void>;
}

export function EnvironmentPanel({ entries, activeStableId, onObjectClick, envReady, onRunCode, onRefreshEnv }: EnvironmentPanelProps) {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

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

  async function handleDelete(rName: string) {
    setMenuOpen(null);
    await onRunCode(`rm(\`${rName}\`)`);
    await onRefreshEnv();
  }

  function handleRenameStart(entry: EnvEntry) {
    setMenuOpen(null);
    setRenamingId(entry.stableId);
    setRenameValue(entry.rName);
  }

  async function handleRenameSubmit(oldName: string) {
    const newName = renameValue.trim();
    setRenamingId(null);
    if (!newName || newName === oldName) return;
    await onRunCode(`\`${newName}\` <- \`${oldName}\`; rm(\`${oldName}\`)`);
    await onRefreshEnv();
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {entries.map((entry) => {
        const isActive = entry.stableId === activeStableId;
        const isRenaming = renamingId === entry.stableId;

        return (
          <div
            key={entry.stableId}
            className={`group relative w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
              isActive
                ? "bg-accent/10 text-accent"
                : "text-text hover:bg-surface-hover"
            }`}
          >
            {/* Clickable row area */}
            <button
              onClick={() => onObjectClick(entry.stableId)}
              className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
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

              {/* Name (or rename input) */}
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRenameSubmit(entry.rName);
                    if (e.key === "Escape") setRenamingId(null);
                  }}
                  onBlur={() => handleRenameSubmit(entry.rName)}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs font-medium bg-surface border border-border rounded px-1 py-0.5 w-full min-w-0 outline-none focus:border-accent"
                />
              ) : (
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium truncate block">{entry.rName}</span>
                </div>
              )}
            </button>

            {/* Class badge */}
            {!isRenaming && (
              <span className="shrink-0 text-[10px] text-text-muted bg-surface-alt rounded px-1.5 py-0.5">
                {entry.class}
              </span>
            )}

            {/* Dimensions */}
            {!isRenaming && (
              <span className="shrink-0 text-[10px] text-text-muted tabular-nums">
                {entry.isDataFrame && entry.nrow !== undefined && entry.ncol !== undefined
                  ? `${entry.nrow} x ${entry.ncol}`
                  : entry.length !== undefined
                    ? `len ${entry.length}`
                    : ""}
              </span>
            )}

            {/* 3-dot menu button — visible on hover */}
            {!isRenaming && (
              <div className="relative shrink-0" ref={menuOpen === entry.stableId ? menuRef : undefined}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(menuOpen === entry.stableId ? null : entry.stableId);
                  }}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-surface-alt transition-opacity cursor-pointer"
                  title="Actions"
                >
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <circle cx="10" cy="4" r="1.5" />
                    <circle cx="10" cy="10" r="1.5" />
                    <circle cx="10" cy="16" r="1.5" />
                  </svg>
                </button>

                {/* Dropdown menu */}
                {menuOpen === entry.stableId && (
                  <div className="absolute right-0 top-6 z-50 bg-surface border border-border rounded-md shadow-lg py-1 min-w-[100px]">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRenameStart(entry); }}
                      className="w-full text-left px-3 py-1.5 text-xs text-text hover:bg-surface-hover transition-colors cursor-pointer"
                    >
                      Rename
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(entry.rName); }}
                      className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-surface-hover transition-colors cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
