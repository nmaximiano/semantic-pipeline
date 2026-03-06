"use client";

import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { API, getAccessToken } from "@/lib/api";

interface FeedbackWidgetProps {
  plan: string | null;
}

export default function FeedbackWidget({ plan }: FeedbackWidgetProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<"bug" | "feature" | "general">("general");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Auto-close after success
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => {
      setSuccess(false);
      setOpen(false);
    }, 2000);
    return () => clearTimeout(t);
  }, [success]);

  if (!plan) return null;

  async function handleSubmit() {
    if (!message.trim() || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API}/feedback`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          category,
          message: message.trim(),
          page_url: window.location.pathname,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to submit");
      }
      setMessage("");
      setCategory("general");
      setSuccess(true);
    } catch (e: any) {
      setError(e.message || "Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div ref={popoverRef} className="fixed bottom-5 right-5 z-50">
      <AnimatePresence>
        {open && !success && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-14 right-0 w-80 bg-surface border border-border rounded-xl shadow-xl overflow-hidden"
          >
            <div className="px-4 pt-4 pb-3 border-b border-border">
              <h3 className="text-sm font-semibold text-text">Send Feedback</h3>
              <p className="text-xs text-text-muted mt-0.5">Help us improve R·Base</p>
            </div>

            <div className="p-4 space-y-3">
              {/* Category */}
              <div className="flex gap-1.5">
                {(["bug", "feature", "general"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors capitalize ${
                      category === c
                        ? "border-accent/50 bg-accent/10 text-accent"
                        : "border-border text-text-muted hover:text-text hover:bg-surface-alt"
                    }`}
                  >
                    {c === "bug" ? "Bug" : c === "feature" ? "Feature" : "General"}
                  </button>
                ))}
              </div>

              {/* Message */}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What's on your mind?"
                rows={3}
                className="w-full bg-surface-alt border border-border rounded-lg px-3 py-2 text-sm text-text placeholder:text-text-muted outline-none focus:border-accent/50 transition-colors resize-none"
              />

              {error && (
                <p className="text-xs text-error">{error}</p>
              )}

              {/* Submit */}
              <button
                onClick={handleSubmit}
                disabled={!message.trim() || submitting}
                className="w-full py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                {submitting ? "Sending..." : "Send feedback"}
              </button>
            </div>
          </motion.div>
        )}

        {success && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-14 right-0 w-64 bg-surface border border-accent/30 rounded-xl shadow-xl p-4 text-center"
          >
            <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-2">
              <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-text">Thanks for your feedback!</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating button */}
      <button
        onClick={() => { setOpen(!open); setSuccess(false); setError(""); }}
        className="w-10 h-10 rounded-full bg-accent text-white shadow-lg hover:opacity-90 transition-opacity flex items-center justify-center"
        title="Send feedback"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      </button>
    </div>
  );
}
