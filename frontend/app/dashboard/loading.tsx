function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="h-5 w-3/4 rounded animate-shimmer mb-4" />
      <div className="flex gap-2 mb-4">
        <div className="h-5 w-20 rounded-full animate-shimmer" />
        <div className="h-5 w-16 rounded-full animate-shimmer" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-4 w-16 rounded animate-shimmer" />
        <div className="h-4 w-12 rounded animate-shimmer" />
      </div>
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="h-screen flex flex-col bg-surface">
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
      <div className="flex-1 overflow-auto px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <div className="h-9 w-64 rounded animate-shimmer mb-1.5" />
            <div className="h-4 w-40 rounded animate-shimmer" />
          </div>
          <div className="flex items-center gap-3 mb-5">
            <div className="h-9 w-56 rounded-lg animate-shimmer" />
            <div className="h-9 w-24 rounded-lg animate-shimmer" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
