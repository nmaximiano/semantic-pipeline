export default function PlansLoading() {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
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
            <div className="h-8 w-20 rounded-lg animate-shimmer" />
            <div className="h-4 w-4 rounded animate-shimmer" />
          </div>
        </div>
      </nav>
      <main className="flex-1 overflow-auto bg-surface-alt flex items-center justify-center">
        <div className="max-w-4xl w-full mx-auto px-6 py-12">
          <div className="grid md:grid-cols-2 gap-8">
            {/* Free card skeleton */}
            <div className="rounded-2xl border border-border bg-surface p-9 flex flex-col">
              <div className="mb-7">
                <div className="h-4 w-10 rounded animate-shimmer" />
                <div className="mt-4 h-12 w-16 rounded animate-shimmer" />
              </div>
              <div className="space-y-4 flex-1">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between py-2">
                    <div className="h-4 w-28 rounded animate-shimmer" />
                    <div className="h-4 w-16 rounded animate-shimmer" />
                  </div>
                ))}
              </div>
              <div className="mt-8 h-12 w-full rounded-xl animate-shimmer" />
            </div>
            {/* Pro card skeleton */}
            <div className="rounded-2xl border border-border bg-surface p-9 flex flex-col">
              <div className="mb-7">
                <div className="h-4 w-8 rounded animate-shimmer" />
                <div className="mt-4 h-12 w-16 rounded animate-shimmer" />
              </div>
              <div className="space-y-4 flex-1">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between py-2">
                    <div className="h-4 w-28 rounded animate-shimmer" />
                    <div className="h-4 w-16 rounded animate-shimmer" />
                  </div>
                ))}
                <div className="pt-3 border-t border-border">
                  <div className="h-4 w-28 rounded animate-shimmer" />
                  <div className="h-3.5 w-52 rounded animate-shimmer mt-2" />
                </div>
              </div>
              <div className="mt-8 h-12 w-full rounded-xl animate-shimmer" />
            </div>
          </div>
          <div className="h-4 w-64 rounded animate-shimmer mx-auto mt-7" />
        </div>
      </main>
    </div>
  );
}
