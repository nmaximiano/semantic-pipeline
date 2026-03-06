"use client";

import { memo, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import type { ChatMessage } from "@/lib/session-types";
import { highlightR } from "@/components/RConsole";
import { formatToolName } from "@/lib/format";
import { PlotLightbox } from "./PlotLightbox";

/** Normalize LaTeX delimiters the agent uses into remark-math's expected format */
function prepareMath(text: string): string {
  return text
    .replace(/\\\[/g, "$$$$")   // \[ → $$
    .replace(/\\\]/g, "$$$$")   // \] → $$
    .replace(/\\\(/g, "$")      // \( → $
    .replace(/\\\)/g, "$");     // \) → $
}

const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

export const ToolMessageItem = memo(function ToolMessageItem({ msg }: { msg: ChatMessage }) {
  return (
    <div className="border-l-2 border-accent/30 pl-3 py-1.5">
      <div className="flex items-center gap-2 text-[13px]">
        {msg.toolStatus === "running" ? (
          <div className="h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-accent border-t-transparent animate-spin" />
        ) : (
          <svg className="w-3.5 h-3.5 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
        <span className="font-semibold text-text">
          {formatToolName(msg.toolName || "")}
        </span>
      </div>
      {msg.toolArgs && Object.keys(msg.toolArgs).length > 0 && (
        <div className="mt-1 ml-[22px] text-[13px] text-text-muted space-y-0.5">
          {Object.entries(msg.toolArgs).map(([k, v]) => (
            <div key={k}>
              <span className="text-text-muted">{k}:</span>{" "}
              <span className="text-text">{String(v)}</span>
            </div>
          ))}
        </div>
      )}
      {msg.progress !== undefined && msg.toolStatus === "running" && (
        <div className="mt-1.5 ml-[22px] flex items-center gap-2">
          <div className="h-1 bg-surface-alt rounded-full overflow-hidden w-32">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500"
              style={{ width: `${msg.progress}%` }}
            />
          </div>
          <span className="text-[13px] text-text-muted tabular-nums">{msg.progress}%</span>
        </div>
      )}
      {msg.toolStatus === "completed" && msg.text && (
        <div className="mt-1 ml-[22px] text-[13px] text-text-muted">
          {msg.text.length > 320 ? msg.text.slice(0, 320) + "..." : msg.text}
        </div>
      )}
    </div>
  );
});

/** Strip markdown images with non-renderable src (attachment://, empty, etc.) */
function stripBrokenImages(text: string): string {
  return text.replace(/!\[[^\]]*\]\((?:attachment:\/\/[^)]*|)\)/g, "");
}

const consoleFontStyle: React.CSSProperties = {
  fontFamily: 'var(--font-source-code-pro), "Source Code Pro", ui-monospace, monospace',
};

const mdComponents: Record<string, React.ComponentType<React.HTMLAttributes<HTMLElement> & { node?: unknown }>> = {
  code({ className, children, node, ...props }: React.HTMLAttributes<HTMLElement> & { node?: unknown }) {
    const isBlock = className?.startsWith("language-");
    const text = String(children).replace(/\n$/, "");
    if (isBlock) {
      return <code className={`${className ?? ""} !text-sm`} style={consoleFontStyle} {...props}>{highlightR(text)}</code>;
    }
    // Inline code
    return <code style={consoleFontStyle} {...props}>{highlightR(text)}</code>;
  },
  pre({ children, node, ...props }: React.HTMLAttributes<HTMLElement> & { node?: unknown }) {
    return <pre style={consoleFontStyle} {...props}>{children}</pre>;
  },
};

export const AssistantMessageItem = memo(function AssistantMessageItem({ msg }: { msg: ChatMessage }) {
  return (
    <div className="pr-8 prose prose-sm max-w-none text-text prose-headings:text-text prose-strong:text-text prose-p:text-text prose-li:text-text prose-th:text-text-secondary prose-td:text-text prose-a:text-accent prose-pre:bg-surface prose-pre:border prose-pre:border-border prose-thead:border-border prose-tr:border-border">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={mdComponents}>{stripBrokenImages(prepareMath(msg.text))}</ReactMarkdown>
    </div>
  );
});

export const UserMessageItem = memo(function UserMessageItem({ msg }: { msg: ChatMessage }) {
  return (
    <div className="flex justify-end pl-8">
      <div className="bg-accent rounded-2xl rounded-br-sm px-4 py-3">
        <p className="text-[15px] text-white whitespace-pre-wrap">{msg.text}</p>
      </div>
    </div>
  );
});

export const PlotMessageItem = memo(function PlotMessageItem({ msg }: { msg: ChatMessage }) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  return (
    <div className="pr-8">
      <div className="rounded-lg border border-border overflow-hidden bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={msg.imageSrc}
          alt="R plot"
          className="w-full h-auto cursor-zoom-in"
          onClick={() => setLightboxOpen(true)}
        />
      </div>
      {lightboxOpen && msg.imageSrc && (
        <PlotLightbox src={msg.imageSrc} onClose={() => setLightboxOpen(false)} />
      )}
    </div>
  );
});

export const QuotaMessageItem = memo(function QuotaMessageItem({ msg }: { msg: ChatMessage }) {
  const hasProFeatures = msg.userPlan === "pro" || msg.userPlan === "max";
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-2.5">
      <p className="text-[15px] font-semibold text-red-400">{msg.text}</p>
      <p className="text-[13px] text-text-secondary">
        {hasProFeatures
          ? "Your weekly credits have been used up. They reset every 7 days."
          : "Upgrade to Pro for 10x more weekly credits, more AI models, and larger datasets."}
      </p>
      <Link
        href="/plans"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg px-4 py-2 transition-colors"
      >
        {hasProFeatures ? "View plan details" : "Upgrade to Pro"}
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <path fillRule="evenodd" d="M2 8a.75.75 0 0 1 .75-.75h8.69L8.22 4.03a.75.75 0 0 1 1.06-1.06l4.5 4.5a.75.75 0 0 1 0 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06l3.22-3.22H2.75A.75.75 0 0 1 2 8Z" clipRule="evenodd" />
        </svg>
      </Link>
    </div>
  );
});

export const AskUserMessageItem = memo(function AskUserMessageItem({
  msg,
  onAnswer,
}: {
  msg: ChatMessage;
  onAnswer: (askId: string, answer: string) => void;
}) {
  const [value, setValue] = useState("");

  if (msg.answered) {
    return <AssistantMessageItem msg={msg} />;
  }

  return (
    <div className="pr-8 space-y-3">
      <div className="prose prose-sm max-w-none text-text prose-headings:text-text prose-strong:text-text prose-p:text-text prose-li:text-text prose-code:text-accent prose-a:text-accent">
        <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>{prepareMath(msg.text)}</ReactMarkdown>
      </div>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) {
              onAnswer(msg.askId!, value.trim());
              setValue("");
            }
          }}
          className="flex-1 rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm text-text placeholder:text-text-muted outline-none focus:border-accent transition-colors"
          placeholder="Type your answer..."
        />
        <button
          onClick={() => {
            if (value.trim()) {
              onAnswer(msg.askId!, value.trim());
              setValue("");
            }
          }}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors cursor-pointer"
        >
          Send
        </button>
      </div>
    </div>
  );
});
