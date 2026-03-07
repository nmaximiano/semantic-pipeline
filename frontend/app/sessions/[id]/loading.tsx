export default function SessionLoading() {
  return (
    <div className="h-screen flex flex-col bg-surface-alt">
      {/* Nav skeleton */}
      <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-lg animate-shimmer" />
              <div className="h-5 w-16 rounded animate-shimmer" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 rounded animate-shimmer" />
            <div className="h-[22px] w-11 rounded-full animate-shimmer" />
            <div className="h-4 w-4 rounded animate-shimmer" />
          </div>
        </div>
      </nav>
      {/* Session toolbar skeleton */}
      <div className="shrink-0 border-b border-border bg-surface px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="h-3.5 w-3.5 rounded animate-shimmer" />
          <div className="h-3.5 w-32 rounded animate-shimmer" />
          <div className="h-3 w-px bg-border" />
          <div className="h-3 w-16 rounded animate-shimmer" />
        </div>
      </div>
      {/* Content skeleton — sidebar + center + chat */}
      <div className="flex-1 flex flex-row overflow-hidden">
        {/* Left sidebar skeleton: icon bar + panel */}
        <div className="shrink-0 flex flex-row bg-surface border-r border-border" style={{ width: `${40 + 260}px` }}>
          {/* Icon strip */}
          <div className="shrink-0 w-10 flex flex-col items-center pt-2 gap-1 border-r border-border">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 w-8 rounded-md animate-shimmer" />
            ))}
          </div>
          {/* Panel */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="shrink-0 flex items-center px-3 h-9 border-b border-border">
              <div className="h-3 w-20 rounded animate-shimmer" />
            </div>
            <div className="flex-1 flex items-center justify-center px-4">
              <div className="h-3 w-36 rounded animate-shimmer" />
            </div>
          </div>
        </div>
        {/* Drag handle */}
        <div className="shrink-0 w-1" />

        {/* Center column skeleton: tabs + table + console */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs skeleton */}
          <div className="shrink-0 flex items-center gap-2 px-4 border-b border-border bg-surface h-12">
            {[0, 1].map((i) => (
              <div key={i} className="h-7 w-28 rounded animate-shimmer" />
            ))}
            <div className="h-5 w-5 rounded animate-shimmer" />
          </div>
          {/* Table area */}
          <div className="flex-1 flex items-center justify-center">
            <div className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
          {/* Console skeleton */}
          <div className="shrink-0 h-1 border-t border-border" />
          <div className="shrink-0 bg-surface flex items-center h-8 border-t border-border">
            <div className="flex items-center gap-1.5 px-3 h-full">
              <div className="h-3.5 w-3.5 rounded animate-shimmer" />
              <div className="h-3 w-14 rounded animate-shimmer" />
            </div>
          </div>
          <div className="shrink-0 bg-surface-alt" style={{ height: "140px" }}>
            <div className="flex items-center gap-2 px-3 pt-2">
              <div className="h-3 w-3 rounded animate-shimmer" />
              <div className="h-3 w-48 rounded animate-shimmer" />
            </div>
          </div>
        </div>

        {/* Right panel drag handle */}
        <div className="shrink-0 w-1" />

        {/* Chat panel skeleton */}
        <div className="shrink-0 w-[480px] border-l border-border bg-surface flex flex-col">
          {/* Chat header */}
          <div className="shrink-0 flex items-center px-4 border-b border-border h-12">
            <div className="flex items-center gap-1.5 px-4 py-3">
              <div className="h-4 w-4 rounded animate-shimmer" />
              <div className="h-4 w-12 rounded animate-shimmer" />
            </div>
          </div>
          {/* Chat empty state */}
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            <div className="h-8 w-8 rounded animate-shimmer mb-3" />
            <div className="h-4 w-40 rounded animate-shimmer mb-2" />
            <div className="h-3 w-56 rounded animate-shimmer" />
          </div>
          {/* Chat input */}
          <div className="shrink-0 px-4 pb-4 pt-2">
            <div className="h-[52px] rounded-xl border border-border animate-shimmer" />
          </div>
        </div>
      </div>
    </div>
  );
}
