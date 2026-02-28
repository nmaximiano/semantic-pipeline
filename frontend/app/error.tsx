"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="h-screen flex items-center justify-center bg-surface px-4">
      <div className="text-center max-w-md">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-surface-alt border border-border flex items-center justify-center mb-6">
          <svg className="w-6 h-6 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-text mb-2">Something went wrong</h1>
        <p className="text-sm text-text-muted mb-6">
          An unexpected error occurred. You can try again or go back to the dashboard.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="py-2 px-5 rounded-lg text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-colors"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="py-2 px-5 rounded-lg text-sm font-medium border border-border text-text-secondary hover:bg-surface-hover transition-colors"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
