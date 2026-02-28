"use client";

import { memo, useState, useRef } from "react";

export const ChatInput = memo(function ChatInput({
  onSend,
  onStop,
  isTyping,
  disabled,
}: {
  onSend: (text: string) => void;
  onStop: () => void;
  isTyping: boolean;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const text = value.trim();
    if (!text || isTyping || disabled) return;
    onSend(text);
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
  }

  return (
    <div className="shrink-0 px-4 py-3">
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-surface-alt px-3 py-2 focus-within:ring-1 focus-within:ring-accent focus-within:border-accent transition-colors">
        <textarea
          ref={ref}
          rows={1}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={disabled ? "Select a dataset first..." : "Ask about this dataset..."}
          disabled={disabled}
          className="flex-1 resize-none bg-transparent text-[15px] text-text placeholder:text-text-muted focus:outline-none max-h-[100px] leading-snug disabled:opacity-50"
        />
        {isTyping ? (
          <button
            onClick={onStop}
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-error/20 text-error hover:bg-error/30 transition-colors"
            title="Stop"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!value.trim() || disabled}
            className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
              value.trim() && !disabled
                ? "bg-accent text-white hover:bg-accent-hover"
                : "text-text-muted"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
});
