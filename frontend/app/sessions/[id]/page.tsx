"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useTheme } from "@/lib/useTheme";
import { useRuntime } from "@/lib/useRuntime";
import RuntimeToast from "@/components/RuntimeToast";
import { useResizablePanel } from "@/lib/useResizablePanel";
import { useLeftSidebar } from "@/lib/useLeftSidebar";
import { usePlotStore } from "@/lib/usePlotStore";
import { useDataTable } from "@/lib/useDataTable";
import { useSessionData } from "@/lib/useSessionData";
import { useREnvironment } from "@/lib/useREnvironment";
import { useAgentChat } from "@/lib/useAgentChat";
import SettingsMenu from "@/components/SettingsMenu";
import * as localDatasets from "@/lib/datasets";
import * as localSessions from "@/lib/sessions";
import * as chatMemory from "@/lib/chatMemory";
import { loadTableIntoR, saveRFrameToDuckDB, execAndSync } from "@/lib/webr-duckdb-bridge";
import { listREnvironment } from "@/lib/webr";
import {
  getViewTableName,
  buildRegistry,
  cleanRVarName,
  persistRenames,
} from "@/lib/registry";
import {
  type ChatMessage,
  nextMsgId,
} from "@/lib/session-types";
import { formatBytes } from "@/lib/format";
import RConsole from "@/components/RConsole";
import type { RConsoleHandle } from "@/components/RConsole";
import { LeftSidebar } from "@/components/session/LeftSidebar";
import { PlanCard } from "@/components/session/PlanChecklist";
import { ChatInput } from "@/components/session/ChatInput";
import {
  ToolMessageItem,
  AssistantMessageItem,
  UserMessageItem,
  PlotMessageItem,
  QuotaMessageItem,
  AskUserMessageItem,
} from "@/components/session/ChatMessages";
import { API, getAccessToken } from "@/lib/api";
import { flushCheckpoint } from "@/lib/duckdb";
import { takePendingUploads } from "@/lib/pendingUploads";
import { getPreference, setPreference } from "@/lib/preferences";

const LOGO_ANTHROPIC = (
  <svg className="w-4 h-4 shrink-0" fill="#D4A27F" viewBox="0 0 16 16">
    <path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/>
  </svg>
);
const LOGO_GEMINI = (
  <svg className="w-4 h-4 shrink-0" viewBox="0 0 65 65">
    <defs>
      <clipPath id="gm-tr"><rect x="32.5" y="0" width="32.5" height="32.5"/></clipPath>
      <clipPath id="gm-br"><rect x="32.5" y="32.5" width="32.5" height="32.5"/></clipPath>
      <clipPath id="gm-bl"><rect x="0" y="32.5" width="32.5" height="32.5"/></clipPath>
      <clipPath id="gm-tl"><rect x="0" y="0" width="32.5" height="32.5"/></clipPath>
    </defs>
    <path clipPath="url(#gm-tr)" fill="#EA4335" d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z"/>
    <path clipPath="url(#gm-br)" fill="#4285F4" d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z"/>
    <path clipPath="url(#gm-bl)" fill="#34A853" d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z"/>
    <path clipPath="url(#gm-tl)" fill="#FBBC05" d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z"/>
  </svg>
);
const LOGO_MINIMAX = (
  <svg className="w-4 h-4 shrink-0" fill="#E8503A" fillRule="evenodd" viewBox="0 0 24 24">
    <path d="M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709.74.74 0 00.743-.709V9.099a2.06 2.06 0 012.071-2.049A2.06 2.06 0 0124 9.1v6.561a.649.649 0 01-.652.645.649.649 0 01-.653-.645V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v7.472a2.037 2.037 0 01-2.048 2.026 2.037 2.037 0 01-2.048-2.026v-12.5a.785.785 0 00-.788-.753.785.785 0 00-.789.752l-.001 15.904A2.037 2.037 0 0113.441 22a2.037 2.037 0 01-2.048-2.026V18.04c0-.356.292-.645.652-.645.36 0 .652.289.652.645v1.934c0 .263.142.506.372.638.23.131.514.131.744 0a.734.734 0 00.372-.638V4.07c0-1.143.937-2.07 2.093-2.07zm-5.674 0c1.156 0 2.093.927 2.093 2.07v11.523a.648.648 0 01-.652.645.648.648 0 01-.652-.645V4.07a.785.785 0 00-.789-.78.785.785 0 00-.789.78v14.013a2.06 2.06 0 01-2.07 2.048 2.06 2.06 0 01-2.071-2.048V9.1a.762.762 0 00-.766-.758.762.762 0 00-.766.758v3.8a2.06 2.06 0 01-2.071 2.049A2.06 2.06 0 010 12.9v-1.378c0-.357.292-.646.652-.646.36 0 .653.29.653.646V12.9c0 .418.343.757.766.757s.766-.339.766-.757V9.099a2.06 2.06 0 012.07-2.048 2.06 2.06 0 012.071 2.048v8.984c0 .419.343.758.767.758.423 0 .766-.339.766-.758V4.07c0-1.143.937-2.07 2.093-2.07z"/>
  </svg>
);
const LOGO_DEEPSEEK = (
  <svg className="w-4 h-4 shrink-0" fill="#4D6BFE" viewBox="0 0 24 24">
    <path d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z"/>
  </svg>
);

const LOGO_OPENAI = (
  <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 16 16">
    <path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z"/>
  </svg>
);
const LOGO_KATCODER = (
  <svg className="w-4 h-4 shrink-0" fill="#FF6B35" clipRule="evenodd" viewBox="0 0 24 24">
    <path d="M11.765.03C5.327.03.108 5.25.108 11.686c0 3.514 1.556 6.665 4.015 8.804L9.89 8.665h6.451L9.31 23.083c.807.173 1.63.26 2.455.26 6.438 0 11.657-5.22 11.657-11.658S18.202.028 11.765.028V.03z"/>
  </svg>
);
const LOGO_MERCURY = (
  <svg className="w-4 h-4 shrink-0" fill="#8B5CF6" viewBox="0 0 24 24">
    <path d="M14.767 1H7.884L1 7.883v6.884h6.884V7.883h6.883V1zM9.234 23h6.882L23 16.116V9.233h-6.884v6.883H9.234V23z"/>
  </svg>
);

const MODEL_LOGOS: Record<string, React.ReactNode> = {
  "anthropic/claude-opus-4.6": LOGO_ANTHROPIC,
  "anthropic/claude-sonnet-4.6": LOGO_ANTHROPIC,
  "openai/gpt-5.4": LOGO_OPENAI,
  "openai/gpt-5.1-codex-max": LOGO_OPENAI,
  "openai/gpt-5.1-codex-mini": LOGO_OPENAI,
  "google/gemini-3-flash-preview": LOGO_GEMINI,
  "google/gemini-3.1-flash-lite-preview": LOGO_GEMINI,
  "minimax/minimax-m2.5": LOGO_MINIMAX,
  "inception/mercury-2": LOGO_MERCURY,
  "kwaipilot/kat-coder-pro": LOGO_KATCODER,
  "deepseek/deepseek-v3.2": LOGO_DEEPSEEK,
};

const MODEL_DESCRIPTIONS: Record<string, string> = {
  "anthropic/claude-opus-4.6": "The smartest and most independent model, at a high cost. Use for complex multi-step tasks where cheaper models fail.",
  "anthropic/claude-sonnet-4.6": "High-end reasoning at a lower cost than Opus. Great for complex analysis and multi-step pipelines.",
  "openai/gpt-5.4": "OpenAI's latest flagship. Strong reasoning and code generation across all tasks.",
  "openai/gpt-5.1-codex-max": "Powerful code-focused model. Excellent for complex R pipelines and data transformations.",
  "google/gemini-3-flash-preview": "The most balanced model and the overall recommended pick. Good reasoning at a good price point.",
  "openai/gpt-5.1-codex-mini": "Compact code model from OpenAI. Solid R code generation at a low cost.",
  "minimax/minimax-m2.5": "Solid mid-range model. Reliable for standard transforms and analysis.",
  "google/gemini-3.1-flash-lite-preview": "Lightweight Gemini variant. Fast and affordable for standard tasks.",
  "inception/mercury-2": "A new diffusion-based LLM designed for speed. Generates all tokens in parallel rather than one at a time, delivering fast results at low cost.",
  "kwaipilot/kat-coder-pro": "Purpose-built for agentic tasks. Excels at multi-step code generation, tool use, and autonomous problem-solving at a low cost.",
  "deepseek/deepseek-v3.2": "Fast and cheap. Good for simple tasks and quick questions.",
};

// tier: "free" | "pro" | "max" — the minimum plan required to use this model
const MODEL_OPTIONS: { id: string; label: string; credits: number; tier: string; recommended?: boolean }[] = [
  { id: "anthropic/claude-opus-4.6", label: "Claude Opus 4.6", credits: 50, tier: "max" },
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", credits: 38, tier: "max" },
  { id: "openai/gpt-5.4", label: "GPT-5.4", credits: 34, tier: "max" },
  { id: "openai/gpt-5.1-codex-max", label: "GPT-5.1 Codex Max", credits: 26, tier: "max" },
  { id: "google/gemini-3-flash-preview", label: "Gemini 3 Flash", credits: 14, tier: "pro", recommended: true },
  { id: "openai/gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini", credits: 8, tier: "pro" },
  { id: "minimax/minimax-m2.5", label: "MiniMax M2.5", credits: 8, tier: "pro" },
  { id: "google/gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite", credits: 7, tier: "free" },
  { id: "inception/mercury-2", label: "Mercury 2", credits: 6, tier: "pro" },
  { id: "kwaipilot/kat-coder-pro", label: "KAT-Coder Pro", credits: 6, tier: "pro" },
  { id: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", credits: 4, tier: "free" },
];

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, max: 2 };

function isModelAvailable(modelTier: string, userPlan: string): boolean {
  return (TIER_RANK[userPlan] ?? 0) >= (TIER_RANK[modelTier] ?? 0);
}

const DEFAULT_MODEL_BY_PLAN: Record<string, string> = {
  free: "google/gemini-3.1-flash-lite-preview",
  pro: "google/gemini-3-flash-preview",
  max: "google/gemini-3-flash-preview",
};

export default function SessionWorkspacePage() {
  const params = useParams();
  const sessionId = params.id as string;
  const { theme, toggle: toggleTheme } = useTheme();
  const consoleRef = useRef<RConsoleHandle>(null);

  // Get userId early for DuckDB OPFS scoping (before useRuntime)
  const [authUserId, setAuthUserId] = useState<string | undefined>(undefined);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setAuthUserId(session.user.id);
    });
  }, []);

  const { status: runtimeStatus, progress: runtimeProgress, duckdbReady } = useRuntime(authUserId);

  // Flush pending DuckDB WAL to OPFS before page unload (prevents chat history loss)
  useEffect(() => {
    const handler = () => { flushCheckpoint(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Surface OPFS quota errors as a dismissible banner
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      setStorageWarning((e as CustomEvent).detail);
    };
    window.addEventListener("duckdb-storage-error", handler);
    return () => window.removeEventListener("duckdb-storage-error", handler);
  }, []);

  // Session data hook (auth, session loading, dataset CRUD)
  const sessionData = useSessionData(sessionId, duckdbReady);
  const {
    session, plan, usage, authLoading,
    sessionName, setSessionName,
    sessionDatasets, setSessionDatasets, sessionDatasetsRef,
    activeDatasetId, setActiveDatasetId,
    loading, error, setError,
    isRenamingSession, setIsRenamingSession,
    sessionRenameValue, setSessionRenameValue,
    sessionRenameRef, handleSessionRename,
    handleLogout,
    fetchSessionLocal,
    refreshUsage,
  } = sessionData;

  // Shared state: activeStableId is used by both R env and data table
  const [activeStableId, setActiveStableId] = useState<string | null>(null);

  // Data table hook (called first so setters are available for R env hook)
  const dataTable = useDataTable(activeStableId, duckdbReady);
  const {
    rowsCache, setRowsCache,
    page, setPage, perPage, sortCol, setSortCol, sortDir, setSortDir,
    refreshing, setRefreshing,
    activeCell, setActiveCell,
    tableRef, rowsData, refetchRef,
    handleSort, handlePerPageChange, handleKeyDown,
    totalRows, totalPages, startRow, endRow, activeCellValue,
    resetPagination,
  } = dataTable;

  // R environment hook
  const rEnv = useREnvironment({
    sessionId, runtimeStatus,
    sessionDatasets, sessionDatasetsRef, setSessionDatasets,
    sessionDataLoaded: !loading,
    activeStableId, setActiveStableId,
    setError, setRowsCache, setSortCol, setSortDir,
  });
  const {
    registry, setRegistry, registryRef,
    objectSummary,
    activeEntry, activeRName, registryEntries,
    syncedToView, envInitDone, envReady,
    refreshEnv, fetchObjectRows, handleObjectTabClick, resetEnv,
  } = rEnv;

  // Chat hook
  const chat = useAgentChat(sessionId, duckdbReady);
  const {
    messages, setMessages,
    isTyping, setIsTyping,
    messagesEndRef, abortRef,
    queueMessage,
    handleStopChat: chatStopChat,
    handleClearChat,
  } = chat;

  // Right panel tab + model selection
  const [rightPanelTab, setRightPanelTab] = useState<"agent" | "config">("agent");
  const defaultModel = DEFAULT_MODEL_BY_PLAN[plan ?? "free"] ?? DEFAULT_MODEL_BY_PLAN.free;
  const [selectedModel, setSelectedModel] = useState(defaultModel);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);

  // Load model preference from DuckDB on mount — only if available for plan
  useEffect(() => {
    if (!duckdbReady) return;
    getPreference("agent_model").then((val) => {
      if (val) {
        const opt = MODEL_OPTIONS.find((m) => m.id === val);
        if (opt && isModelAvailable(opt.tier, plan ?? "free")) {
          setSelectedModel(val);
        }
      }
    }).catch(() => {});
  }, [duckdbReady, plan]);

  // If plan changes and current model is no longer available, reset to default
  useEffect(() => {
    const opt = MODEL_OPTIONS.find((m) => m.id === selectedModel);
    if (opt && !isModelAvailable(opt.tier, plan ?? "free")) {
      const fallback = DEFAULT_MODEL_BY_PLAN[plan ?? "free"] ?? DEFAULT_MODEL_BY_PLAN.free;
      setSelectedModel(fallback);
    }
  }, [plan]);

  function handleModelChange(modelId: string) {
    const opt = MODEL_OPTIONS.find((m) => m.id === modelId);
    if (!opt || !isModelAvailable(opt.tier, plan ?? "free")) return;
    setSelectedModel(modelId);
    setPreference("agent_model", modelId).catch(() => {});
  }

  // Left sidebar
  const sidebar = useLeftSidebar();
  const { plots, addPlots, removePlot, clearPlots } = usePlotStore(sessionId, duckdbReady);
  const [codeHistoryRefreshKey, setCodeHistoryRefreshKey] = useState(0);

  // Bottom console panel — resizable height (always visible)
  const CONSOLE_MIN = 140;
  const CONSOLE_MAX = 600;
  const CONSOLE_DEFAULT = 380;
  const [consoleHeight, setConsoleHeight] = useState(CONSOLE_DEFAULT);
  const isDraggingConsole = useRef(false);
  const consoleDragStartY = useRef(0);
  const consoleDragStartH = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDraggingConsole.current) return;
      const delta = consoleDragStartY.current - e.clientY;
      setConsoleHeight(Math.min(CONSOLE_MAX, Math.max(CONSOLE_MIN, consoleDragStartH.current + delta)));
    }
    function onMouseUp() {
      if (!isDraggingConsole.current) return;
      isDraggingConsole.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Add dataset modal state (inlined)
  const [showAddDataset, setShowAddDataset] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportNote, setReportNote] = useState("");
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [uploadingInModal, setUploadingInModal] = useState(false);
  const [modalDragging, setModalDragging] = useState(false);
  const modalFileRef = useRef<HTMLInputElement>(null);
  const modalDragCounter = useRef(0);

  function handleOpenAddDataset() {
    setUploadingInModal(false);
    setModalDragging(false);
    modalDragCounter.current = 0;
    setShowAddDataset(true);
  }

  // Resizable right panel
  const { panelWidth, handlePanelDragStart } = useResizablePanel();

  // Active registry entry (replaces activeEnvObj)
  const activeEnvObj = activeEntry;

  // Wire data table refetch callback
  refetchRef.current = (args) => {
    const entry = registry.get(args.activeStableId);
    if (entry?.isDataFrame) {
      fetchObjectRows(args.activeStableId, entry.rName, args.page, args.perPage, args.sortCol, args.sortDir);
    }
  };

  async function refreshActiveDataset() {
    // Refresh R environment listing + rebuild registry
    syncedToView.current.clear();
    const newReg = await refreshEnv();

    // If viewing an R env object, refresh its data
    if (activeStableId && activeRName) {
      const entry = newReg.get(activeStableId);
      if (entry?.isDataFrame) {
        await fetchObjectRows(activeStableId, entry.rName, page, perPage, sortCol ?? undefined, sortDir);
      }
    }
  }

  async function handleRefresh() {
    if (!session || !activeStableId) return;
    setRefreshing(true);
    try {
      syncedToView.current.clear();
      await refreshActiveDataset();
    } finally {
      setRefreshing(false);
    }
  }



  // Tab management
  async function handleRemoveDataset(e: React.MouseEvent, datasetId: string) {
    e.stopPropagation();
    try {
      await localSessions.removeDatasetFromSession(sessionId, datasetId);
      // Also delete the underlying dataset data (session-internal)
      await localDatasets.deleteDataset(datasetId);
      setSessionDatasets((prev) => prev.filter((d) => d.id !== datasetId));
      setRowsCache((prev) => {
        const next = { ...prev };
        delete next[datasetId];
        return next;
      });
      if (activeDatasetId === datasetId) {
        const remaining = sessionDatasets.filter((d) => d.id !== datasetId);
        setActiveDatasetId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (e) {
      console.error("[session] handleRemoveDataset failed:", e);
    }
  }

  async function handleModalUpload(file: File) {
    if (uploadingInModal) return;

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (["csv", "tsv", "parquet"].includes(ext)) {
      // DuckDB flow — falls through to code below
    } else if (ext === "dta") {
      // Stata .dta flow via WebR's haven package
      setUploadingInModal(true);
      console.log(`[upload] Starting .dta upload: "${file.name}" (${file.size} bytes)`);
      try {
        if (runtimeStatus !== "ready") {
          setError("R environment is not ready yet. Please wait and try again.");
          setUploadingInModal(false);
          return;
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        const webr = (await import("@/lib/webr")).getWebR();
        const { evalR } = await import("@/lib/webr");
        if (!webr) throw new Error("WebR not initialized");

        // 1. Install haven if needed, then write to WebR virtual filesystem
        await webr.installPackages(["haven"], { quiet: true });
        await webr.FS.writeFile("/tmp/" + file.name, bytes);

        // 2. Read .dta via haven::read_dta
        const rName = cleanRVarName(file.name);
        const readResult = await evalR(`library(haven); ${rName} <- as.data.frame(read_dta("/tmp/${file.name}"))`);
        if (readResult.error) throw new Error(readResult.error);

        // 3. Build a labels data.frame from variable label attributes
        const labelsRName = `${rName}_labels`;
        const labelsResult = await evalR(`{
          .labs <- sapply(${rName}, function(x) { l <- attr(x, "label"); if (is.null(l)) NA_character_ else l })
          if (any(!is.na(.labs))) {
            ${labelsRName} <- data.frame(variable = names(.labs), label = unname(.labs), stringsAsFactors = FALSE)
          }
          rm(.labs)
        }`);
        if (labelsResult.error) console.warn("[upload] Labels extraction warning:", labelsResult.error);

        // 4. Get columns and row count from R
        const colResult = await evalR(`cat(paste(colnames(${rName}), collapse="\\t"))`);
        const colNames = (colResult.stdout || "").split("\t").filter(Boolean);
        const nrowResult = await evalR(`cat(nrow(${rName}))`);
        const rowCount = parseInt(nrowResult.stdout || "0", 10);

        // 5. Sync main data.frame to DuckDB
        const tableName = `ds_${crypto.randomUUID().replace(/-/g, "_")}`;
        await saveRFrameToDuckDB(rName, tableName);

        // 6. Create dataset and add to session
        const { createDatasetFromRFrame } = await import("@/lib/datasets");
        const ds = await createDatasetFromRFrame(rName, tableName, colNames, rowCount);
        await localSessions.addDatasetToSession(sessionId, ds.id, rName);

        // 7. If labels data.frame was created, sync it too
        const hasLabels = await evalR(`cat(exists("${labelsRName}"))`);
        if (hasLabels.stdout?.trim() === "TRUE") {
          const labelsTable = `ds_${crypto.randomUUID().replace(/-/g, "_")}`;
          await saveRFrameToDuckDB(labelsRName, labelsTable);
          const labelsColResult = await evalR(`cat(paste(colnames(${labelsRName}), collapse="\\t"))`);
          const labelsCols = (labelsColResult.stdout || "").split("\t").filter(Boolean);
          const labelsNrowResult = await evalR(`cat(nrow(${labelsRName}))`);
          const labelsRowCount = parseInt(labelsNrowResult.stdout || "0", 10);
          const labelsDs = await createDatasetFromRFrame(labelsRName, labelsTable, labelsCols, labelsRowCount);
          await localSessions.addDatasetToSession(sessionId, labelsDs.id, labelsRName);
        }

        // 8. Refresh session state and registry
        envInitDone.current = true;
        await fetchSessionLocal();
        syncedToView.current.clear();
        const objs = await listREnvironment();
        const newReg = buildRegistry(objs, sessionDatasetsRef.current, registryRef.current);
        setRegistry(newReg);

        // 9. Set main data.frame as active dataset
        setActiveStableId(ds.id);
        setSortCol(null);
        setSortDir("asc");
        setPage(1);
        await fetchObjectRows(ds.id, rName, 1, 50);

        console.log("[upload] .dta upload complete:", rName);
        setShowAddDataset(false);
      } catch (e: any) {
        console.error("[upload] .dta upload failed:", e);
        setError(e.message || "Stata upload failed");
      } finally {
        setUploadingInModal(false);
      }
      return;
    } else if (["rdata", "rda", "rds"].includes(ext)) {
      // .RData flow handled below
      setUploadingInModal(true);
      console.log(`[upload] Starting .RData upload: "${file.name}" (${file.size} bytes)`);
      try {
        if (runtimeStatus !== "ready") {
          setError("R environment is not ready yet. Please wait and try again.");
          setUploadingInModal(false);
          return;
        }

        const bytes = new Uint8Array(await file.arrayBuffer());

        // 1. Store blob for reload persistence
        const { storeRDataBlob } = await import("@/lib/rdata");
        await storeRDataBlob(sessionId, file.name, bytes);

        // 2. Write to WebR virtual filesystem
        const webr = (await import("@/lib/webr")).getWebR();
        const { evalR } = await import("@/lib/webr");
        if (!webr) throw new Error("WebR not initialized");
        await webr.FS.writeFile("/tmp/" + file.name, bytes);

        // 3. Execute R load/readRDS and capture loaded object names
        let loadedNames: string[] = [];
        if (ext === "rds") {
          const baseName = file.name.replace(/\.rds$/i, "").replace(/[^a-zA-Z0-9_]/g, "_");
          const rdsResult = await evalR(`${baseName} <- readRDS("/tmp/${file.name}")`);
          if (rdsResult.error) throw new Error(rdsResult.error);
          loadedNames = [baseName];
        } else {
          // load() returns the names of objects it loaded
          const loadResult = await evalR(`cat(load("/tmp/${file.name}"), sep="\\t")`);
          if (loadResult.error) throw new Error(loadResult.error);
          loadedNames = (loadResult.stdout || "").split("\t").filter(Boolean);
        }

        if (loadedNames.length === 0) {
          setError("No objects found in the uploaded file");
          setUploadingInModal(false);
          return;
        }

        // 4. Discover which loaded objects are data.frames
        const afterObjs = await listREnvironment();
        const loadedSet = new Set(loadedNames);
        const newDataFrames = afterObjs.filter(
          (o) => o.isDataFrame && loadedSet.has(o.name)
        );

        if (newDataFrames.length === 0) {
          setError("No data.frames found in the uploaded file");
          setUploadingInModal(false);
          return;
        }

        // 5. Remove non-data.frame objects loaded from the file (e.g. stray chr strings)
        const dfNames = new Set(newDataFrames.map((o) => o.name));
        const junkNames = loadedNames.filter((n) => !dfNames.has(n));
        if (junkNames.length > 0) {
          await evalR(`rm(${junkNames.map((n) => `\`${n}\``).join(", ")}, envir = .GlobalEnv)`);
        }

        console.log(`[upload] Found ${newDataFrames.length} data.frames:`, newDataFrames.map((o) => o.name));

        // 6. For each data.frame: deduplicate name if needed, sync to DuckDB, create dataset
        const { createDatasetFromRFrame } = await import("@/lib/datasets");
        const currentDsList = sessionDatasetsRef.current;
        const usedRNames = new Set(currentDsList.map((d) => d.r_name).filter(Boolean));
        for (const df of newDataFrames) {
          try {
            let rName = df.name;
            if (usedRNames.has(rName)) {
              // Find a unique suffix: data_2, data_3, ...
              let n = 2;
              while (usedRNames.has(`${df.name}_${n}`)) n++;
              rName = `${df.name}_${n}`;
              // Rename in R so both old and new coexist
              await evalR(`\`${rName}\` <- \`${df.name}\``);
              console.log(`[upload] Renamed duplicate "${df.name}" -> "${rName}" in R`);
            }
            usedRNames.add(rName);

            const tableName = `ds_${crypto.randomUUID().replace(/-/g, "_")}`;
            await saveRFrameToDuckDB(rName, tableName);
            const colNames = df.ncol
              ? (await evalR(`cat(paste(colnames(${rName}), collapse="\\t"))`)).stdout.split("\t").filter(Boolean)
              : [];
            const ds = await createDatasetFromRFrame(rName, tableName, colNames, df.nrow ?? 0);
            await localSessions.addDatasetToSession(sessionId, ds.id, rName);
          } catch (e) {
            console.error(`[upload] Failed to sync data.frame "${df.name}":`, e);
          }
        }

        // 7. Refresh session state
        // Mark env-init done BEFORE updating sessionDatasets to prevent the
        // env-init useEffect from firing and racing with our post-upload logic
        envInitDone.current = true;
        await fetchSessionLocal();

        // 8. Rebuild registry and pre-sync view tables
        syncedToView.current.clear();
        const objs = await listREnvironment();
        const newReg = buildRegistry(objs, sessionDatasetsRef.current, registryRef.current);
        setRegistry(newReg);

        // Pre-sync ALL data.frame view tables to avoid race condition on tab click
        let firstSyncedEntry: { stableId: string; rName: string } | null = null;
        for (const [, entry] of newReg) {
          if (entry.isDataFrame) {
            try {
              const viewTable = getViewTableName(entry.stableId);
              await saveRFrameToDuckDB(entry.rName, viewTable);
              syncedToView.current.add(entry.stableId);
              if (!firstSyncedEntry) firstSyncedEntry = entry;
            } catch (e) {
              console.warn(`[upload] View table sync failed for "${entry.rName}":`, e);
            }
          }
        }

        // 9. Set first data.frame as active
        if (firstSyncedEntry) {
          setActiveStableId(firstSyncedEntry.stableId);
          setSortCol(null);
          setSortDir("asc");
          setPage(1);
          await fetchObjectRows(firstSyncedEntry.stableId, firstSyncedEntry.rName, 1, 50);
        }

        console.log("[upload] .RData upload complete:", afterObjs.map((o) => `${o.name}(${o.isDataFrame ? "df" : o.class})`));
        setShowAddDataset(false);
      } catch (e: any) {
        console.error("[upload] .RData upload failed:", e);
        setError(e.message || "RData upload failed");
      } finally {
        setUploadingInModal(false);
      }
      return;
    } else {
      setError("Supported formats: CSV, TSV, Parquet, Stata (.dta), RData");
      return;
    }

    setUploadingInModal(true);
    console.log(`[upload] Starting upload: "${file.name}" (${file.size} bytes)`);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ds = await localDatasets.createDataset(file.name, bytes);
      console.log(`[upload] Dataset created in DuckDB: id=${ds.id}`);
      await handleAddDataset(ds.id);

      // Load into R with clean variable name
      if (runtimeStatus === "ready") {
        const tableName = await localDatasets.getDatasetTableName(ds.id);
        if (tableName) {
          try {
            const cleanName = cleanRVarName(file.name);
            console.log(`[upload] Loading into R as "${cleanName}" from table "${tableName}"`);
            await loadTableIntoR(tableName, cleanName);
            await localSessions.updateSessionDatasetRName(sessionId, ds.id, cleanName);
            // Update local sessionDatasets state with r_name
            setSessionDatasets((prev) =>
              prev.map((d) => d.id === ds.id ? { ...d, r_name: cleanName } : d)
            );
            syncedToView.current.clear();
            const objs = await listREnvironment();
            const updatedDsList = sessionDatasetsRef.current.map(d => d.id === ds.id ? { ...d, r_name: cleanName } : d);
            const newReg = buildRegistry(objs, updatedDsList, registryRef.current);
            setRegistry(newReg);
            console.log("[upload] R env after upload:", objs.map(o => `${o.name}(${o.isDataFrame ? "df" : o.class})`));
            setActiveStableId(ds.id);
            setSortCol(null);
            setSortDir("asc");
            setPage(1);
            // Sync to view table for display
            await fetchObjectRows(ds.id, cleanName, 1, 50);
          } catch (e) {
            console.error("[upload] Failed to load into R:", e);
          }
        }
      }
    } catch (e: any) {
      console.error("[upload] Upload failed:", e);
      setError(e.message || "Upload failed");
      setUploadingInModal(false);
    }
  }

  async function handleAddDataset(datasetId: string) {
    try {
      await localSessions.addDatasetToSession(sessionId, datasetId);
      // Prevent env-init from racing with our upload post-processing
      envInitDone.current = true;
      await fetchSessionLocal();
      setActiveDatasetId(datasetId);
    } catch (e) {
      console.error("[session] handleAddExistingDataset failed:", e);
    }
    setShowAddDataset(false);
  }

  // Process files deferred from the dashboard (R-format files that need WebR)
  const pendingUploadsProcessed = useRef(false);
  useEffect(() => {
    if (pendingUploadsProcessed.current || runtimeStatus !== "ready" || loading) return;
    const files = takePendingUploads(sessionId);
    if (files.length === 0) { pendingUploadsProcessed.current = true; return; }
    pendingUploadsProcessed.current = true;
    (async () => {
      for (const file of files) {
        await handleModalUpload(file);
      }
    })();
  }, [runtimeStatus, loading, sessionId]);

  async function handleSendMessage(text: string) {
    if (!text || isTyping) return;

    const userMsg: ChatMessage = { id: nextMsgId(), role: "user", text, time: new Date() };
    setMessages((prev) => [...prev, userMsg]);

    setIsTyping(true);
    const abort = new AbortController();
    abortRef.current = abort;

    // Collect assistant response parts for chat memory
    const assistantParts: string[] = [];
    const rCodeParts: string[] = [];
    const plotDataUrls: string[] = [];
    let streamingMsgId: string | null = null;

    try {
      // Build dataset context from R environment — include ALL data.frames
      let datasetContext: Record<string, any> | undefined;
      const otherDataframes: Array<{ name: string; columns: string[]; row_count: number }> = [];

      if (runtimeStatus === "ready") {
        const { evalR } = await import("@/lib/webr");

        // Get info for each data.frame in the registry
        for (const entry of registryEntries) {
          if (!entry.isDataFrame) continue;
          try {
            const colResult = await evalR(`cat(paste(colnames(${entry.rName}), collapse="\\t"))`);
            const columns = colResult.stdout.split("\t").filter(Boolean);
            const info = { name: entry.rName, columns, row_count: entry.nrow ?? 0 };

            if (entry.stableId === activeStableId) {
              datasetContext = info;
            } else {
              otherDataframes.push(info);
            }
          } catch {
            const info = { name: entry.rName, columns: [] as string[], row_count: entry.nrow ?? 0 };
            if (entry.stableId === activeStableId) {
              datasetContext = info;
            } else {
              otherDataframes.push(info);
            }
          }
        }
      }

      // Get chat history from local memory (strip plots — backend doesn't need base64 images)
      const history = (await chatMemory.getHistory(sessionId)).map(
        ({ user, assistant, r_code }) => ({ user, assistant, r_code })
      );

      // Track active R variable name (agent works with it directly, no alias)
      const activeRVar = activeRName;
      // Snapshot registry BEFORE agent runs (for rename detection)
      let preExecRegistry = new Map(registry);
      console.log("[agent] Active R var:", activeRVar, "stableId:", activeStableId, "| Pre-exec entries:", registryEntries.map(e => e.rName));

      const token = await getAccessToken();
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          session_id: sessionId,
          dataset_context: datasetContext,
          other_dataframes: otherDataframes.length > 0 ? otherDataframes : undefined,
          history,
          model: selectedModel,
        }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to get response");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const dataLine = part
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!dataLine) continue;
          const payload = dataLine.slice(6);
          if (payload === "[DONE]") continue;

          let event: any;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }

          switch (event.type) {
            case "r_code": {
              // Agent wants us to execute R code
              const { execution_id, code, description } = event;
              console.log(`[agent] R code received (${execution_id}):`, code.slice(0, 200));
              rCodeParts.push(code);

              // Show running indicator
              queueMessage((prev) => [
                ...prev,
                {
                  id: nextMsgId(),
                  role: "tool",
                  text: "",
                  toolName: "R code",
                  toolArgs: { code: code.length > 200 ? code.slice(0, 200) + "..." : code },
                  toolStatus: "running",
                  time: new Date(),
                },
              ]);

              // Execute R code via WebR
              let execResult: { success: boolean; stdout: string; stderr: string; error: string | null; dataChanged?: boolean } = {
                success: false, stdout: "", stderr: "", error: "Runtime not ready",
              };

              const viewTable = activeStableId ? getViewTableName(activeStableId) : null;
              console.log(`[agent] Executing R code. viewTable="${viewTable}", activeRVar="${activeRVar}"`);

              if (runtimeStatus === "ready" && viewTable) {
                try {
                  const r = await execAndSync(code, viewTable, activeRVar!);
                  execResult = {
                    success: !r.error,
                    stdout: r.stdout,
                    stderr: r.stderr,
                    error: r.error,
                    dataChanged: r.dataChanged,
                  };
                  console.log(`[agent] R exec result: success=${execResult.success}, dataChanged=${r.dataChanged}, stdout=${(r.stdout || "").slice(0, 100)}`);

                  // Render any plot images inline in chat + capture to plot store (skip on error — partial plots are usually empty/broken)
                  if (r.images && r.images.length > 0 && !r.error) {
                    addPlots(r.images, "agent", code);
                    for (const img of r.images) {
                      try {
                        const canvas = document.createElement("canvas");
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext("2d");
                        if (ctx) {
                          ctx.drawImage(img, 0, 0);
                          const dataUrl = canvas.toDataURL("image/png");
                          plotDataUrls.push(dataUrl);
                          queueMessage((prev) => [
                            ...prev,
                            {
                              id: nextMsgId(),
                              role: "plot" as const,
                              text: "",
                              time: new Date(),
                              imageSrc: dataUrl,
                            },
                          ]);
                        }
                      } catch (e) {
                        console.error("[session] Plot canvas render failed:", e);
                      }
                    }
                  }

                  // Show in R console (always mounted)
                  const cmdResult = r.error || r.stderr || r.stdout || "OK";
                  consoleRef.current?.appendAgentCommand(code, cmdResult);

                  // Persist successful agent R code for replay on reload
                  if (!r.error) {
                    try {
                      const { appendRCode } = await import("@/lib/rCodeHistory");
                      await appendRCode(sessionId, code, "agent");
                    } catch (e) {
                      console.error("[session] appendRCode failed:", e);
                    }
                    setCodeHistoryRefreshKey((k) => k + 1);
                  }
                } catch (e: any) {
                  execResult = {
                    success: false,
                    stdout: "",
                    stderr: "",
                    error: e.message || "R execution failed",
                  };
                }
              }

              // Update tool message to completed
              queueMessage((prev) => {
                const updated = [...prev];
                for (let i = updated.length - 1; i >= 0; i--) {
                  if (updated[i].role === "tool" && updated[i].toolName === "R code" && updated[i].toolStatus === "running") {
                    updated[i] = {
                      ...updated[i],
                      toolStatus: "completed",
                      text: execResult.success
                        ? (execResult.stdout || "Executed successfully.")
                        : `Error: ${execResult.error}`,
                    };
                    break;
                  }
                }
                return updated;
              });

              // Registry reconciliation after R code execution
              let updatedActiveDataset: { name: string; columns: string[]; row_count: number } | undefined;
              let updatedOtherDatasets: Array<{ name: string; columns: string[]; row_count: number }> = [];
              {
                try {
                  const { listREnvironment: listEnv, evalR: evalRLocal } = await import("@/lib/webr");

                  // Reset sort/page — columns may have changed
                  setSortCol(null);
                  setSortDir("asc");
                  setPage(1);
                  syncedToView.current.clear();

                  // Rebuild registry from current R env state
                  // Use ref to get latest sessionDatasets (avoids stale closure)
                  const postObjs = await listEnv();
                  const newRegistry = buildRegistry(postObjs, sessionDatasetsRef.current, preExecRegistry);
                  setRegistry(newRegistry);
                  preExecRegistry = newRegistry;

                  // Collect updated schema for backend context refresh
                  for (const entry of newRegistry.values()) {
                    if (!entry.isDataFrame) continue;
                    try {
                      const cr = await evalRLocal(`cat(paste(colnames(${entry.rName}), collapse="\\t"))`);
                      const cols = (cr.stdout || "").split("\t").filter(Boolean);
                      const info = { name: entry.rName, columns: cols, row_count: entry.nrow ?? 0 };
                      if (entry.stableId === activeStableId) {
                        updatedActiveDataset = info;
                      } else {
                        updatedOtherDatasets.push(info);
                      }
                    } catch {
                      // skip — schema refresh is best-effort
                    }
                  }

                  // Detect renames and persist them
                  await persistRenames(sessionId, newRegistry, preExecRegistry, setSessionDatasets);

                  // Clean up view tables + session_datasets for entries that disappeared
                  for (const [stableId, oldEntry] of preExecRegistry) {
                    if (!newRegistry.has(stableId)) {
                      const oldView = getViewTableName(stableId);
                      try {
                        const { queryDuckDB } = await import("@/lib/duckdb");
                        await queryDuckDB(`DROP TABLE IF EXISTS "${oldView}"`);
                      } catch (e) {
                        console.error("[session] Failed to drop old view table:", e);
                      }
                      // If this was a dataset-backed entry, remove from session so it doesn't respawn on reload
                      if (oldEntry.datasetId) {
                        try {
                          await localSessions.removeDatasetFromSession(sessionId, oldEntry.datasetId);
                          setSessionDatasets((prev) => prev.filter((d) => d.id !== oldEntry.datasetId));
                          console.log(`[agent] Removed dataset ${oldEntry.datasetId} (${oldEntry.rName}) from session after rm()`);
                        } catch (e) {
                          console.error("[session] Failed to remove dataset from session:", e);
                        }
                      }
                    }
                  }

                  // If active entry was removed, switch to first available data.frame
                  if (activeStableId && !newRegistry.has(activeStableId)) {
                    const fallback = Array.from(newRegistry.values()).find(e => e.isDataFrame);
                    const fallbackId = fallback?.stableId ?? null;
                    setActiveStableId(fallbackId);
                    if (fallback) {
                      await fetchObjectRows(fallback.stableId, fallback.rName, 1, 50);
                    }
                  } else if (activeStableId && newRegistry.has(activeStableId)) {
                    // Refresh active entry's data
                    const entry = newRegistry.get(activeStableId)!;
                    if (entry.isDataFrame) {
                      await fetchObjectRows(activeStableId, entry.rName, 1, 50);
                    }
                  }
                } catch (syncErr) {
                  console.error("[agent] Post-execution sync error:", syncErr);
                  syncedToView.current.clear();
                  await refreshEnv();
                }
              }

              // POST result back to backend
              try {
                const resultToken = await getAccessToken();
                await fetch(`${API}/chat/result`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${resultToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    execution_id,
                    success: execResult.success,
                    stdout: execResult.stdout,
                    stderr: execResult.stderr,
                    error: execResult.error,
                    ...(updatedActiveDataset && { active_dataset: updatedActiveDataset }),
                    ...(updatedOtherDatasets.length > 0 && { other_datasets: updatedOtherDatasets }),
                  }),
                });
              } catch (e) {
                console.error("[session] POST chat/result failed:", e);
              }
              break;
            }

            case "r_code_result":
              // Backend acknowledgement of R result (already handled above)
              break;

            case "message_delta": {
              const delta = event.content || "";
              if (!streamingMsgId) {
                streamingMsgId = nextMsgId();
                const sid = streamingMsgId;
                queueMessage((prev) => [
                  ...prev,
                  {
                    id: sid,
                    role: "assistant",
                    text: delta,
                    time: new Date(),
                    isStreaming: true,
                  },
                ]);
              } else {
                const sid = streamingMsgId;
                queueMessage((prev) =>
                  prev.map((m) =>
                    m.id === sid ? { ...m, text: m.text + delta } : m
                  )
                );
              }
              break;
            }

            case "message_done": {
              const finalText = event.content || "";
              if (streamingMsgId) {
                const sid = streamingMsgId;
                queueMessage((prev) =>
                  prev.map((m) =>
                    m.id === sid
                      ? { ...m, text: finalText, isStreaming: false }
                      : m
                  )
                );
                streamingMsgId = null;
              } else {
                // No deltas preceded — create message directly
                queueMessage((prev) => [
                  ...prev,
                  {
                    id: nextMsgId(),
                    role: "assistant",
                    text: finalText,
                    time: new Date(),
                  },
                ]);
              }
              assistantParts.push(finalText);
              break;
            }

            case "message":
              assistantParts.push(event.content);
              queueMessage((prev) => [
                ...prev,
                {
                  id: nextMsgId(),
                  role: "assistant",
                  text: event.content,
                  time: new Date(),
                },
              ]);
              break;

            case "plan": {
              queueMessage((prev) => {
                const existing = prev.find((m) => m.role === "plan");
                if (existing) {
                  return prev.map((m) =>
                    m === existing ? { ...m, planSteps: event.steps, planActive: true } : m
                  );
                }
                return [
                  ...prev,
                  {
                    id: nextMsgId(),
                    role: "plan" as const,
                    text: "",
                    time: new Date(),
                    planSteps: event.steps,
                    planActive: true,
                  },
                ];
              });
              break;
            }

            case "ask_user": {
              const { ask_id, question } = event;
              queueMessage((prev) => [
                ...prev,
                {
                  id: nextMsgId(),
                  role: "assistant" as const,
                  text: question,
                  time: new Date(),
                  askId: ask_id,
                  askQuestion: question,
                  answered: false,
                },
              ]);
              break;
            }

            case "error":
              if (event.code === "quota_exceeded") {
                queueMessage((prev) => [
                  ...prev,
                  {
                    id: nextMsgId(),
                    role: "quota",
                    text: "You've hit your weekly message limit",
                    time: new Date(),
                    userPlan: event.plan || plan || "free",
                  },
                ]);
              } else {
                queueMessage((prev) => [
                  ...prev,
                  {
                    id: nextMsgId(),
                    role: "assistant",
                    text: "Something went wrong. Please try again.",
                    time: new Date(),
                  },
                ]);
              }
              break;
          }
        }
      }

      // Finalize any orphaned streaming message (e.g. stream interrupted)
      if (streamingMsgId) {
        const sid = streamingMsgId;
        queueMessage((prev) =>
          prev.map((m) =>
            m.id === sid ? { ...m, isStreaming: false } : m
          )
        );
        streamingMsgId = null;
      }

      // Deactivate any active plan cards
      queueMessage((prev) =>
        prev.map((m) =>
          m.role === "plan" && m.planActive ? { ...m, planActive: false } : m
        )
      );

      // Save turn to local chat memory
      const fullAssistant = assistantParts.join("\n\n");
      if (fullAssistant) {
        chatMemory.appendTurn(
          sessionId,
          text,
          fullAssistant,
          rCodeParts.length > 0 ? rCodeParts : undefined,
          plotDataUrls.length > 0 ? plotDataUrls : undefined
        );
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // User cancelled
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: nextMsgId(),
            role: "assistant",
            text: "Something went wrong.",
            time: new Date(),
          },
        ]);
      }
    } finally {
      abortRef.current = null;
      setIsTyping(false);
      refreshUsage();
      if (runtimeStatus === "ready") {
        syncedToView.current.clear();
        const finalReg = await refreshEnv();
        console.log("[agent] Final R env after chat:", Array.from(finalReg.values()).map(e => `${e.rName}(${e.isDataFrame ? "df" : "obj"})`));
      }
    }
  }

  function handleStopChat() {
    chatStopChat(session?.access_token);
  }

  async function handleAgentAnswer(askId: string, answer: string) {
    setMessages((prev) => [
      ...prev.map((m) =>
        m.askId === askId ? { ...m, answered: true } : m
      ),
      {
        id: nextMsgId(),
        role: "user" as const,
        text: answer,
        time: new Date(),
      },
    ]);
    try {
      const answerToken = await getAccessToken();
      await fetch(`${API}/chat/answer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${answerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ask_id: askId, answer }),
      });
    } catch (e) {
      console.error("[session] POST chat/answer failed:", e);
    }
  }

  const handleSendMessageCb = useCallback(
    (text: string) => handleSendMessage(text),
    [session, activeStableId, activeEntry, isTyping, sessionId, registry]
  );

  if (authLoading) {
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
            <div className="shrink-0 bg-surface-alt" style={{ height: "380px" }}>
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
        <RuntimeToast status={runtimeStatus} progress={runtimeProgress} duckdbReady={duckdbReady} />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-surface-alt overflow-hidden">
      {/* Nav */}
      <nav className="shrink-0 border-b border-border bg-surface px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center gap-2.5 cursor-pointer">
              <span className="text-3xl font-[family-name:var(--font-clash)] font-[number:var(--clash-weight)] tracking-tight">
                <span className="text-accent font-bold">R</span><span className="text-text">·Base</span>
              </span>
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-hover transition-colors"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              )}
            </button>
            <Link
              href="/feedback"
              className="text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded-lg shadow-sm shadow-accent/20"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              Give Feedback
            </Link>
            <Link
              href="/plans"
              className={`text-xs font-medium rounded-full px-2.5 py-1 border inline-flex items-center transition-colors cursor-pointer ${
                plan === "max"
                  ? "max-badge"
                  : plan === "pro"
                    ? "pro-badge"
                    : "border-border bg-surface-alt text-text-secondary hover:border-accent/40"
              }`}
            >
              {plan !== null ? (
                plan === "max" ? "Max" : plan === "pro" ? "Pro" : "Free"
              ) : (
                <span className="inline-block h-3 w-7 rounded animate-shimmer" />
              )}
            </Link>
            <SettingsMenu email={session?.user?.email ?? ""} onLogout={handleLogout} plan={plan ?? undefined} usage={usage} />
          </div>
        </div>
      </nav>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 flex items-center gap-3 bg-error-bg border-b border-error-border text-error px-6 py-2 text-xs">
          <span>{error}</span>
          <button
            onClick={() => setError("")}
            className="ml-auto text-error hover:text-error/70 cursor-pointer"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Storage quota warning banner */}
      {storageWarning && (
        <div className="shrink-0 flex items-center gap-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 px-6 py-2 text-xs">
          <span>{storageWarning}</span>
          <button
            onClick={() => setStorageWarning(null)}
            className="ml-auto text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200 cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Add dataset modal */}
      {showAddDataset && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowAddDataset(false); }}
        >
          <div
            className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden"
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); modalDragCounter.current++; if (e.dataTransfer.types.includes("Files")) setModalDragging(true); }}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); modalDragCounter.current--; if (modalDragCounter.current === 0) setModalDragging(false); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); modalDragCounter.current = 0; setModalDragging(false); const f = e.dataTransfer.files?.[0]; if (f) handleModalUpload(f); }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h3 className="text-sm font-semibold text-text">Upload dataset</h3>
              <button
                onClick={() => setShowAddDataset(false)}
                className="w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:text-text hover:bg-surface-alt transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Upload zone */}
            <div className="px-5 pb-5">
              <div
                className={`relative border border-dashed rounded-lg px-3 py-2.5 text-center transition-colors ${
                  modalDragging
                    ? "border-accent bg-accent/5"
                    : "border-border hover:border-accent/40"
                }`}
              >
                {uploadingInModal ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-3.5 w-3.5 rounded-full border-[1.5px] border-accent border-t-transparent animate-spin" />
                    <span className="text-[11px] font-medium text-text-muted">Uploading...</span>
                  </div>
                ) : (
                  <p className="text-[11px] text-text-muted">
                    Drop a file here, or{" "}
                    <button
                      onClick={() => modalFileRef.current?.click()}
                      className="text-accent hover:text-accent-hover font-medium underline underline-offset-2"
                    >
                      browse
                    </button>
                  </p>
                )}
                <input
                  ref={modalFileRef}
                  type="file"
                  accept=".csv,.tsv,.parquet,.dta,.rdata,.rda,.rds"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleModalUpload(f); }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Session toolbar — single row */}
      <div className="shrink-0 border-b border-border bg-surface">
        <div className="flex items-center gap-4 px-5 h-12">
          {/* Back + session name */}
          <Link
            href="/dashboard"
            className="text-text-muted hover:text-text transition-colors shrink-0 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          {isRenamingSession ? (
            <input
              ref={sessionRenameRef}
              value={sessionRenameValue}
              onChange={(e) => setSessionRenameValue(e.target.value)}
              onBlur={handleSessionRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSessionRename();
                if (e.key === "Escape") setIsRenamingSession(false);
              }}
              className="text-sm font-semibold text-text bg-surface-alt border border-accent rounded px-1.5 py-0.5 outline-none w-48"
              autoFocus
            />
          ) : (
            <button
              onClick={() => { setSessionRenameValue(sessionName); setIsRenamingSession(true); }}
              className="text-sm font-semibold text-text truncate max-w-[160px] hover:text-accent transition-colors cursor-pointer"
              title="Click to rename session"
            >
              {sessionName}
            </button>
          )}
          {activeEnvObj && (
            <>
              <span className="h-4 w-px bg-border shrink-0" />
              <span className="text-xs text-accent font-medium whitespace-nowrap">{activeEnvObj.class}</span>
              {activeEnvObj.isDataFrame && activeEnvObj.nrow !== undefined && (
                <span className="text-xs text-text-muted whitespace-nowrap">&middot; {activeEnvObj.nrow.toLocaleString()} rows</span>
              )}
              {activeEnvObj.isDataFrame && activeEnvObj.ncol !== undefined && (
                <span className="text-xs text-text-muted whitespace-nowrap">&middot; {activeEnvObj.ncol} cols</span>
              )}
              {!activeEnvObj.isDataFrame && activeEnvObj.length !== undefined && (
                <span className="text-xs text-text-muted whitespace-nowrap">&middot; length {activeEnvObj.length}</span>
              )}
            </>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Session action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRefresh}
              disabled={refreshing || !activeEnvObj}
              title="Refresh table data"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-accent/30 text-accent hover:bg-accent/10 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <svg className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.993 4.356v4.992" />
              </svg>
              Refresh
            </button>
            <button
              onClick={() => setShowResetConfirm(true)}
              title="Reset R environment to original datasets"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-error/30 text-error hover:bg-error/10 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.993 4.356v4.992" />
              </svg>
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Reset environment confirmation modal */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowResetConfirm(false); }}
        >
          <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="shrink-0 w-9 h-9 rounded-full bg-error/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text">Reset R environment?</h3>
                <p className="text-xs text-text-muted mt-0.5">This cannot be undone.</p>
              </div>
            </div>
            <p className="text-[13px] text-text-secondary mb-4">
              All transformations, computed variables, and console history will be lost. Datasets will revert to their original uploaded state.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowResetConfirm(false);
                  resetEnv();
                  consoleRef.current?.clearHistory();
                  handleClearChat();
                  clearPlots();
                  setSortCol(null);
                  setSortDir("asc");
                  setPage(1);
                  setActiveCell(null);
                  setError("");
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-error hover:bg-error/85 transition-colors cursor-pointer"
              >
                Reset environment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report conversation modal */}
      {showReportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setShowReportModal(false); }}
        >
          <div className="bg-surface border border-border rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="shrink-0 w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center">
                <svg className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text">Report Conversation</h3>
                <p className="text-xs text-text-muted mt-0.5">Upload for review by the development team.</p>
              </div>
            </div>
            <textarea
              value={reportNote}
              onChange={(e) => setReportNote(e.target.value)}
              placeholder="Optional: describe the issue or context..."
              maxLength={2000}
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-text placeholder:text-text-muted resize-none focus:outline-none focus:ring-1 focus:ring-accent mb-4"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-alt transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={reportStatus === "sending"}
                onClick={async () => {
                  setReportStatus("sending");
                  try {
                    const token = await getAccessToken();
                    const history = await chatMemory.getHistory(sessionId);
                    const res = await fetch(`${API}/conversations/report`, {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        session_id: sessionId,
                        note: reportNote || null,
                        messages,
                        chat_history: history.length > 0 ? history : null,
                      }),
                    });
                    if (!res.ok) throw new Error("Failed to report");
                    setReportStatus("sent");
                    setShowReportModal(false);
                    setTimeout(() => setReportStatus("idle"), 2000);
                  } catch (e) {
                    console.error("[report] Failed:", e);
                    setReportStatus("idle");
                  }
                }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-accent hover:bg-accent/85 transition-colors disabled:opacity-60 cursor-pointer"
              >
                {reportStatus === "sending" ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main area — sidebar + (tabs + table + console) + chat */}
      <div className="flex-1 flex flex-row overflow-hidden">
        {/* Left sidebar: icon bar + panel */}
        <LeftSidebar
          activeTab={sidebar.activeTab}
          sidebarWidth={sidebar.sidebarWidth}
          onToggleTab={sidebar.toggleTab}
          onDragStart={sidebar.handleSidebarDragStart}
          envEntries={registryEntries}
          activeStableId={activeStableId}
          onObjectClick={handleObjectTabClick}
          envReady={envReady}
          onRunCode={async (code: string) => {
            const { evalR } = await import("@/lib/webr");
            const result = await evalR(code);
            const output = [result.stdout, result.stderr, result.error].filter(Boolean).join("\n");
            consoleRef.current?.appendAgentCommand(code, output);
          }}
          onRefreshEnv={async () => {
            syncedToView.current.clear();
            const prevReg = registryRef.current;
            const newReg = await refreshEnv();
            await persistRenames(sessionId, newReg, prevReg, setSessionDatasets);
            for (const [stableId, oldEntry] of prevReg) {
              if (!newReg.has(stableId) && oldEntry.datasetId) {
                try {
                  await localSessions.removeDatasetFromSession(sessionId, oldEntry.datasetId);
                  setSessionDatasets((prev) => prev.filter((d) => d.id !== oldEntry.datasetId));
                } catch (e) {
                  console.error("[session] env action: remove dataset from session failed:", e);
                }
              }
            }
          }}
          plots={plots}
          onDeletePlot={removePlot}
          onClearPlots={clearPlots}
          sessionId={sessionId}
          codeHistoryRefreshKey={codeHistoryRefreshKey}
        />

        {/* Center column: tabs + table + footer + console */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* R environment tabs */}
          <div className="shrink-0 flex items-center gap-0 px-4 overflow-x-auto min-w-0 border-b border-border bg-surface h-12">
            {registryEntries.map((entry) => (
              <button
                key={entry.stableId}
                onClick={() => handleObjectTabClick(entry.stableId)}
                className={`group relative flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer select-none ${
                  activeStableId === entry.stableId
                    ? "border-accent text-accent bg-surface-alt/50"
                    : "border-transparent text-text-muted hover:text-text hover:bg-surface-alt/30"
                }`}
              >
                {entry.isDataFrame ? (
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.745 3A23.933 23.933 0 003 12c0 3.183.62 6.22 1.745 9M19.5 3c.967 2.78 1.5 5.817 1.5 9s-.533 6.22-1.5 9M8.25 8.885l1.444-.89a.75.75 0 011.105.402l2.402 7.206a.75.75 0 001.105.401l1.444-.889" />
                  </svg>
                )}
                <span className="truncate max-w-[180px]">{entry.rName}</span>
                {entry.isDataFrame && entry.nrow !== undefined && (
                  <span className="text-[10px] text-text-muted ml-0.5">
                    {entry.nrow > 999 ? `${(entry.nrow / 1000).toFixed(0)}k` : entry.nrow}
                  </span>
                )}
              </button>
            ))}
            {registryEntries.length === 0 && envReady && (
              <span className="text-xs text-text-muted px-3 py-3">No R objects</span>
            )}
{/* R env loading state shown in main viewer area, not here */}
            <button
              onClick={handleOpenAddDataset}
              className="flex items-center gap-1 px-3 py-3 text-sm text-text-muted hover:text-accent transition-colors cursor-pointer"
              title="Upload data"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>
            {/* Download active dataset */}
            {activeEnvObj?.isDataFrame && (
              <button
                onClick={async () => {
                  if (!activeStableId || !activeRName) return;
                  try {
                    const viewTable = getViewTableName(activeStableId);
                    await saveRFrameToDuckDB(activeRName, viewTable);
                    const { queryDuckDB } = await import("@/lib/duckdb");
                    const result = await queryDuckDB(`SELECT * FROM "${viewTable}"`);
                    const header = result.columns.join(",");
                    const rows = result.rows.map((row) =>
                      row.map((v) => {
                        if (v === null || v === undefined) return "";
                        const s = String(v);
                        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
                          return `"${s.replace(/"/g, '""')}"`;
                        }
                        return s;
                      }).join(",")
                    );
                    const csv = [header, ...rows].join("\n");
                    const blob = new Blob([csv], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${activeRName}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (e: any) {
                    setError(e.message || "Download failed");
                  }
                }}
                title="Download as CSV"
                className="ml-auto flex items-center gap-1 px-3 py-3 text-sm text-text-muted hover:text-accent transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </button>
            )}
          </div>
          {/* Loading R environment state */}
          {registryEntries.length === 0 && !envReady && runtimeStatus !== "error" ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="h-8 w-8 mx-auto mb-3 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
                <p className="text-sm font-medium text-text mb-1">Setting up R environment</p>
                <p className="text-xs text-text-muted">Loading packages and datasets...</p>
              </div>
            </div>
          ) : registryEntries.length === 0 && !loading && envReady ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <svg className="w-10 h-10 text-text-muted mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
                </svg>
                <p className="text-sm font-medium text-text mb-1">No R objects</p>
                <p className="text-xs text-text-muted mb-4">Upload a dataset or create objects in the R console.</p>
                <button
                  onClick={handleOpenAddDataset}
                  className="inline-flex items-center gap-2 bg-text text-surface py-2 px-4 rounded-lg text-xs font-medium hover:bg-text/85 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Upload data
                </button>
              </div>
            </div>
          ) : activeEnvObj && !activeEnvObj.isDataFrame && objectSummary !== null ? (
            /* Non-data.frame object: show summary */
            <div className="flex-1 overflow-auto p-6">
              <div className="mb-3">
                <span className="text-sm font-semibold text-text">{activeRName}</span>
                <span className="text-xs text-text-muted ml-2">({activeEnvObj.class})</span>
              </div>
              <pre className="text-sm leading-normal text-text bg-surface border border-border rounded-lg p-5 whitespace-pre overflow-x-auto" style={{ fontFamily: 'var(--font-source-code-pro), "Source Code Pro", ui-monospace, monospace' }}>{objectSummary.trim()}</pre>
            </div>
          ) : rowsData && rowsData.rows.length > 0 ? (
            <div
              ref={tableRef}
              className="flex-1 overflow-auto focus:outline-none"
              tabIndex={0}
              onKeyDown={handleKeyDown}
              onClick={(e) => {
                const td = (e.target as HTMLElement).closest("td, th");
                if (!td) return;
                const tr = td.closest("tr");
                if (!tr) return;
                const isHeader = !!td.closest("thead");
                const ci = Array.from(tr.children).indexOf(td) - 1;
                if (ci < 0) return;
                if (isHeader) {
                  setActiveCell([-1, ci]);
                } else {
                  const ri = Array.from(
                    tr.closest("tbody")!.children
                  ).indexOf(tr);
                  setActiveCell([ri, ci]);
                }
              }}
            >
              <table className="text-xs border-collapse">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-surface-alt">
                    <th className="sticky left-0 z-20 bg-surface-alt border-b border-r border-border px-2.5 py-2.5 text-center text-text-muted font-medium w-[52px] min-w-[52px]" />
                    {rowsData.columns.map((col, ci) => (
                      <th
                        key={col}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveCell([-1, ci]);
                          handleSort(col);
                        }}
                        className={`border-b border-r border-border px-3.5 py-2.5 text-left font-medium whitespace-nowrap cursor-pointer select-none transition-colors min-w-[140px] ${
                          activeCell?.[0] === -1 && activeCell?.[1] === ci
                            ? "bg-accent/10 text-accent"
                            : "text-text-secondary hover:text-text hover:bg-surface-hover"
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col}
                          {sortCol === col && (
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2.5}
                            >
                              {sortDir === "asc" ? (
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M4.5 15.75l7.5-7.5 7.5 7.5"
                                />
                              ) : (
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                                />
                              )}
                            </svg>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowsData.rows.map((row, ri) => (
                    <tr
                      key={ri}
                      className={
                        ri % 2 === 0 ? "bg-surface" : "bg-surface-alt/50"
                      }
                    >
                      <td className="sticky left-0 z-[5] border-r border-b border-border px-2.5 py-2 text-center text-text-muted font-medium tabular-nums w-[52px] min-w-[52px] bg-inherit text-[13px]">
                        <div
                          className={
                            ri % 2 === 0
                              ? "bg-surface rounded"
                              : "bg-surface-alt/50 rounded"
                          }
                        >
                          {startRow + ri}
                        </div>
                      </td>
                      {row.map((cell, ci) => {
                        const isActive =
                          activeCell?.[0] === ri && activeCell?.[1] === ci;
                        return (
                          <td
                            key={ci}
                            title={String(cell)}
                            className={`border-r border-b border-border/50 px-3.5 py-2 min-w-[140px] max-w-[320px] truncate transition-colors text-[13px] ${
                              isActive
                                ? "outline outline-2 outline-accent bg-accent/5 text-text"
                                : "text-text"
                            }`}
                          >
                            {String(cell)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (loading || (!rowsData && activeStableId && activeEntry?.isDataFrame)) && !error ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <div className="h-6 w-6 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
              <span className="text-xs text-text-muted">Loading dataset</span>
            </div>
          ) : !error && rowsData ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-text-muted text-sm">This dataset has no rows.</p>
            </div>
          ) : (
            <div className="flex-1" />
          )}

          {/* Footer: cell preview + pagination */}
          {rowsData && rowsData.rows.length > 0 && (
            <div className="shrink-0 border-t border-border bg-surface-alt flex items-center px-4 h-8 gap-3 text-[11px] text-text-muted">
              {activeCellValue !== null && (
                <>
                  <span className="shrink-0 font-medium text-text-secondary">
                    {activeCell![0] === -1
                      ? `Col ${activeCell![1] + 1}`
                      : `R${startRow + activeCell![0]}:C${activeCell![1] + 1}`}
                  </span>
                  <span className="text-text truncate max-w-[200px]">{activeCellValue}</span>
                  <span className="h-3 w-px bg-border shrink-0" />
                </>
              )}
              <span className="shrink-0">
                {startRow}–{endRow} of {totalRows.toLocaleString()}
              </span>
              <select
                value={perPage}
                onChange={(e) => handlePerPageChange(Number(e.target.value))}
                className="bg-transparent border-none text-[11px] text-text-muted focus:outline-none cursor-pointer"
              >
                <option value={25}>25/pg</option>
                <option value={50}>50/pg</option>
                <option value={100}>100/pg</option>
              </select>
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-1.5 py-0.5 rounded text-text-muted hover:text-text transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </button>
                <span className="px-1 tabular-nums">{rowsData.page}/{totalPages}</span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-1.5 py-0.5 rounded text-text-muted hover:text-text transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Bottom R console — always visible */}
          {/* Resize handle */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingConsole.current = true;
              consoleDragStartY.current = e.clientY;
              consoleDragStartH.current = consoleHeight;
              document.body.style.cursor = "row-resize";
              document.body.style.userSelect = "none";
            }}
            className="shrink-0 h-1 cursor-row-resize border-t border-border hover:bg-accent/30 active:bg-accent/50 transition-colors"
          />
          {/* Console header */}
          <div className="shrink-0 bg-surface flex items-center h-8">
            <div className="flex items-center gap-1.5 px-3 h-full text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 4 3-4 3" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 15h5" />
              </svg>
              Console
            </div>
            <div className="ml-auto flex items-center gap-1 mr-3">
              {/* Download console history as .R script */}
              <button
                onClick={() => {
                  const entries = consoleRef.current?.getHistory();
                  if (!entries || entries.length === 0) return;
                  const lines: string[] = [];
                  for (const e of entries) {
                    if (e.type === "input") {
                      lines.push(e.text ?? "");
                    } else if (e.type === "output" && e.text) {
                      lines.push(...e.text.split("\n").map((l) => `# ${l}`));
                    } else if (e.type === "error" && e.text) {
                      lines.push(...e.text.split("\n").map((l) => `# ERROR: ${l}`));
                    }
                  }
                  const blob = new Blob([lines.join("\n")], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `console_${sessionName.replace(/\s+/g, "_")}.R`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                title="Download console history"
                className="p-1 rounded text-text-muted hover:text-accent transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
              </button>
              {/* Clear console output */}
              <button
                onClick={() => consoleRef.current?.clearHistory()}
                title="Clear console"
                className="p-1 rounded text-text-muted hover:text-text transition-colors cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                </svg>
              </button>
            </div>
          </div>
          {/* Console body — always uses consoleHeight */}
          <div style={{ height: `${consoleHeight}px` }} className="shrink-0 overflow-hidden">
            <div className="h-full">
              <RConsole
                ref={consoleRef}
                sessionId={sessionId}
                duckdbReady={duckdbReady}
                onDataChanged={async () => {
                  syncedToView.current.clear();
                  const prevReg = registryRef.current;
                  const newReg = await refreshEnv();
                  await persistRenames(sessionId, newReg, prevReg, setSessionDatasets);
                  for (const [stableId, oldEntry] of prevReg) {
                    if (!newReg.has(stableId) && oldEntry.datasetId) {
                      try {
                        await localSessions.removeDatasetFromSession(sessionId, oldEntry.datasetId);
                        setSessionDatasets((prev) => prev.filter((d) => d.id !== oldEntry.datasetId));
                      } catch (e) {
                        console.error("[session] Console: remove dataset from session failed:", e);
                      }
                    }
                  }
                  if (activeStableId && newReg.has(activeStableId)) {
                    const entry = newReg.get(activeStableId);
                    if (entry?.isDataFrame) {
                      await fetchObjectRows(activeStableId, entry.rName, page, perPage, sortCol ?? undefined, sortDir);
                    }
                  } else if (activeStableId && !newReg.has(activeStableId)) {
                    // Active object was removed — fall back to first data.frame or null
                    const fallback = Array.from(newReg.values()).find(e => e.isDataFrame);
                    setActiveStableId(fallback?.stableId ?? null);
                    if (fallback) {
                      await fetchObjectRows(fallback.stableId, fallback.rName, 1, 50);
                    }
                  }
                }}
                onCodeExecuted={async (code) => {
                  try {
                    const { appendRCode } = await import("@/lib/rCodeHistory");
                    await appendRCode(sessionId, code, "user");
                  } catch (e) {
                    console.error("[session] Console: appendRCode failed:", e);
                  }
                  setCodeHistoryRefreshKey((k) => k + 1);
                }}
                onPlotCaptured={(images, code) => addPlots(images, "user", code)}
              />
            </div>
          </div>
        </div>

        {/* Vertical drag handle — right panel */}
        <div
          onMouseDown={handlePanelDragStart}
          className="shrink-0 w-1 cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors"
        />

        {/* Right panel — Agent chat */}
        <div className="shrink-0 border-l border-border bg-surface flex flex-col" style={{ width: `${panelWidth}px` }}>
          {/* Panel header with tabs */}
          <div className="shrink-0 flex items-center px-4 border-b border-border h-12">
            <button
              onClick={() => setRightPanelTab("agent")}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${
                rightPanelTab === "agent"
                  ? "text-text border-b-2 border-accent"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              Agent
            </button>
            <button
              onClick={() => setRightPanelTab("config")}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${
                rightPanelTab === "config"
                  ? "text-text border-b-2 border-accent"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Config
            </button>
            {rightPanelTab === "agent" && messages.length > 0 && (
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  onClick={() => {
                    if (reportStatus === "sent") return;
                    setReportNote("");
                    setReportStatus("idle");
                    setShowReportModal(true);
                  }}
                  disabled={isTyping || reportStatus === "sent"}
                  title={reportStatus === "sent" ? "Reported" : "Report conversation"}
                  className="text-text-muted hover:text-accent transition-colors disabled:opacity-40 cursor-pointer"
                >
                  {reportStatus === "sent" ? (
                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={handleClearChat}
                  disabled={isTyping}
                  title="Clear conversation"
                  className="text-text-muted hover:text-error transition-colors disabled:opacity-40 cursor-pointer"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                </button>
              </div>
            )}
          </div>
          {/* Config panel */}
          {rightPanelTab === "config" && (
            <div className="flex-1 overflow-y-auto px-4 py-5">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-2 uppercase tracking-wide">Model</label>
                  <div className="space-y-1">
                    {MODEL_OPTIONS.map((m) => {
                      const isExpanded = expandedModel === m.id;
                      const desc = MODEL_DESCRIPTIONS[m.id];
                      const available = isModelAvailable(m.tier, plan ?? "free");
                      const locked = !available;
                      const tierLabel = m.tier === "max" ? "Max" : m.tier === "pro" ? "Pro" : null;
                      return (
                        <div key={m.id} className={locked ? "opacity-50" : ""}>
                          <div
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-colors ${
                              locked
                                ? "border border-border text-text-muted cursor-not-allowed"
                                : selectedModel === m.id
                                  ? "bg-accent/10 border border-accent text-text"
                                  : "border border-border text-text-secondary hover:border-accent/40 hover:bg-surface-alt"
                            }${isExpanded ? " rounded-b-none" : ""}`}
                          >
                            <button
                              onClick={() => !locked && handleModelChange(m.id)}
                              className={`flex items-center gap-2 flex-1 min-w-0 ${locked ? "cursor-not-allowed" : "cursor-pointer"}`}
                              disabled={locked}
                            >
                              {MODEL_LOGOS[m.id]}
                              <span className="truncate">{m.label}</span>
                              {m.recommended && !locked && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-medium shrink-0">
                                  Recommended
                                </span>
                              )}
                            </button>
                            <span className="flex items-center gap-1.5 shrink-0 ml-2">
                              {locked && tierLabel ? (
                                <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                  m.tier === "max" ? "max-badge" : "pro-badge"
                                }`}>
                                  {tierLabel}
                                </span>
                              ) : (
                                <span className="text-xs text-text-secondary">~{m.credits} credits</span>
                              )}
                              <button
                                onClick={() => setExpandedModel(isExpanded ? null : m.id)}
                                className="text-text-muted hover:text-text transition-colors cursor-pointer p-0.5"
                                title={isExpanded ? "Hide details" : "Show details"}
                              >
                                <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                                </svg>
                              </button>
                            </span>
                          </div>
                          {isExpanded && desc && (
                            <div className={`px-3 py-2.5 text-xs leading-relaxed border border-t-0 rounded-b-lg ${
                              locked
                                ? "border-border bg-surface-alt/50"
                                : selectedModel === m.id ? "border-accent bg-accent/5" : "border-border bg-surface-alt/50"
                            }`}>
                              <p className="text-text-secondary">{desc}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="text-[11px] text-text-muted leading-relaxed">
                  Billed per token. Complex requests cost more. Model selection persists across sessions.
                </p>
              </div>
            </div>
          )}

          {/* Messages area */}
          {rightPanelTab === "agent" && <div className="flex-1 overflow-y-auto" data-chat-scroll>
            {messages.length === 0 && !isTyping ? (
              <div className="h-full flex flex-col items-center justify-center px-6 text-center">
                <svg
                  className="w-8 h-8 text-accent mb-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
                  />
                </svg>
                <h3 className="text-sm font-semibold text-text mb-1">Transform your datasets</h3>
                <p className="text-xs text-text-muted mb-5 max-w-[280px]">
                  Describe how you'd like to transform, classify, or enrich any column.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {[
                    "Classify sentiment",
                    "Extract keywords",
                    "Translate to Spanish",
                    "Summarize text",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => handleSendMessageCb(suggestion)}
                      className="px-3 py-1.5 rounded-full border border-border text-xs text-text-secondary hover:text-text hover:border-accent/40 hover:bg-surface-alt transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="px-4 py-4 space-y-5">
                {messages.map((msg) => (
                  <div key={msg.id}>
                    {msg.role === "plan" && msg.planSteps ? (
                      <PlanCard steps={msg.planSteps} isActive={msg.planActive ?? false} />
                    ) : msg.role === "tool" ? (
                      <ToolMessageItem msg={msg} />
                    ) : msg.role === "quota" ? (
                      <QuotaMessageItem msg={msg} />
                    ) : msg.role === "plot" && msg.imageSrc ? (
                      <PlotMessageItem msg={msg} />
                    ) : msg.askId && !msg.answered ? (
                      <AskUserMessageItem msg={msg} onAnswer={handleAgentAnswer} />
                    ) : msg.role === "assistant" ? (
                      <AssistantMessageItem msg={msg} />
                    ) : (
                      <UserMessageItem msg={msg} />
                    )}
                  </div>
                ))}

                {/* Typing indicator */}
                {isTyping && (
                  <div className="pr-8">
                    <div className="flex items-center gap-1">
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-text-secondary"
                          style={{ animation: "typing-dot 1.4s ease-in-out infinite", animationDelay: "0ms" }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-text-secondary"
                          style={{ animation: "typing-dot 1.4s ease-in-out infinite", animationDelay: "200ms" }}
                        />
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-text-secondary"
                          style={{ animation: "typing-dot 1.4s ease-in-out infinite", animationDelay: "400ms" }}
                        />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>}

          {/* Input area */}
          {rightPanelTab === "agent" && (
            <ChatInput
              onSend={handleSendMessageCb}
              onStop={handleStopChat}
              isTyping={isTyping}
              disabled={!activeStableId}
            />
          )}
        </div>
      </div>

      <RuntimeToast status={runtimeStatus} progress={runtimeProgress} duckdbReady={duckdbReady} />
    </div>
  );
}
