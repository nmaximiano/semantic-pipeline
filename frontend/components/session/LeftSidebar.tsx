"use client";

import type { SidebarTab } from "@/lib/useLeftSidebar";
import type { StoredPlot } from "@/lib/usePlotStore";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { PlotPanel } from "./PlotPanel";
import { CodeHistoryPanel } from "./CodeHistoryPanel";

/** Minimal env entry shape expected by EnvironmentPanel */
interface EnvEntry {
  stableId: string;
  rName: string;
  class: string;
  isDataFrame: boolean;
  nrow?: number;
  ncol?: number;
  length?: number;
}

interface LeftSidebarProps {
  activeTab: SidebarTab;
  sidebarWidth: number;
  onToggleTab: (tab: SidebarTab) => void;
  onDragStart: (e: React.MouseEvent) => void;
  // Environment panel
  envEntries: EnvEntry[];
  activeStableId: string | null;
  onObjectClick: (stableId: string) => void;
  envReady: boolean;
  // Plot panel
  plots: StoredPlot[];
  onDeletePlot: (plotId: string) => void;
  onClearPlots: () => void;
  // Code history panel
  sessionId: string;
  codeHistoryRefreshKey: number;
}

const ICON_BAR_WIDTH = 40;

const TABS: { id: SidebarTab; label: string; icon: React.ReactNode }[] = [
  {
    id: "env",
    label: "Environment",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
      </svg>
    ),
  },
  {
    id: "plots",
    label: "Plots",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
      </svg>
    ),
  },
  {
    id: "code",
    label: "Code History",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
];

const PANEL_TITLES: Record<SidebarTab, string> = {
  env: "Environment",
  plots: "Plots",
  code: "Code History",
};

export function LeftSidebar({
  activeTab,
  sidebarWidth,
  onToggleTab,
  onDragStart,
  envEntries,
  activeStableId,
  onObjectClick,
  envReady,
  plots,
  onDeletePlot,
  onClearPlots,
  sessionId,
  codeHistoryRefreshKey,
}: LeftSidebarProps) {
  return (
    <>
      {/* Container: icon bar + panel (always open) */}
      <div
        className="shrink-0 flex flex-row bg-surface border-r border-border"
        style={{ width: `${ICON_BAR_WIDTH + sidebarWidth}px` }}
      >
        {/* Icon strip */}
        <div
          className="shrink-0 flex flex-col items-center pt-2 gap-1 border-r border-border bg-surface"
          style={{ width: `${ICON_BAR_WIDTH}px` }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onToggleTab(tab.id)}
                title={tab.label}
                className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                  isActive
                    ? "bg-accent/10 text-accent border-l-2 border-accent -ml-px"
                    : "text-text-muted hover:text-text hover:bg-surface-hover"
                }`}
              >
                {tab.icon}
              </button>
            );
          })}
        </div>

        {/* Panel content */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {/* Panel header */}
          <div className="shrink-0 flex items-center px-3 h-9 border-b border-border">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              {PANEL_TITLES[activeTab]}
            </span>
          </div>

          {/* Panel body */}
          {activeTab === "env" && (
            <EnvironmentPanel
              entries={envEntries}
              activeStableId={activeStableId}
              onObjectClick={onObjectClick}
              envReady={envReady}
            />
          )}
          {activeTab === "plots" && (
            <PlotPanel plots={plots} onDelete={onDeletePlot} onClear={onClearPlots} />
          )}
          {activeTab === "code" && (
            <CodeHistoryPanel
              sessionId={sessionId}
              refreshKey={codeHistoryRefreshKey}
            />
          )}
        </div>
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={onDragStart}
        className="shrink-0 w-1 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors"
      />
    </>
  );
}
