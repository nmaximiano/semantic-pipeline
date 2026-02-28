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
    <html>
      <body>
        <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif" }}>
          <div style={{ textAlign: "center", maxWidth: "400px" }}>
            <h1 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "0.5rem" }}>Something went wrong</h1>
            <p style={{ fontSize: "0.875rem", color: "#666", marginBottom: "1.5rem" }}>
              An unexpected error occurred. The error has been reported.
            </p>
            <button
              onClick={reset}
              style={{ padding: "0.5rem 1.25rem", borderRadius: "0.5rem", fontSize: "0.875rem", fontWeight: 500, background: "#6366f1", color: "white", border: "none", cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
