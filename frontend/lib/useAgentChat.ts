"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import * as chatMemory from "@/lib/chatMemory";
import { type ChatMessage, nextMsgId } from "@/lib/session-types";
import { API, getAccessToken } from "@/lib/api";

export function useAgentChat(sessionId: string, duckdbReady: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // SSE batching: accumulate message mutations, flush once per frame
  const pendingUpdates = useRef<((prev: ChatMessage[]) => ChatMessage[])[]>([]);
  const rafId = useRef<number | null>(null);
  const flushMessages = useCallback(() => {
    if (rafId.current !== null) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      const updates = pendingUpdates.current.splice(0);
      if (updates.length === 0) return;
      setMessages((prev) => {
        let result = prev;
        for (const fn of updates) result = fn(result);
        return result;
      });
    });
  }, []);
  const queueMessage = useCallback(
    (fn: (prev: ChatMessage[]) => ChatMessage[]) => {
      pendingUpdates.current.push(fn);
      flushMessages();
    },
    [flushMessages]
  );

  // Auto-scroll chat panel to bottom when messages change or typing indicator appears.
  // Use instant scroll while streaming (smooth scroll animations stack and jitter at ~60 calls/s).
  useEffect(() => {
    const el = messagesEndRef.current;
    if (!el) return;
    const scrollContainer = el.closest("[data-chat-scroll]");
    if (!scrollContainer) return;
    const isStreaming = messages.some((m) => m.isStreaming);
    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: isStreaming ? "auto" : "smooth",
    });
  }, [messages, isTyping]);

  // Load saved chat history on mount
  const chatHistoryLoaded = useRef(false);
  useEffect(() => {
    if (!duckdbReady || chatHistoryLoaded.current) return;
    chatHistoryLoaded.current = true;
    (async () => {
      try {
        const turns = await chatMemory.getHistory(sessionId);
        if (turns.length > 0) {
          const restored: ChatMessage[] = [];
          for (const turn of turns) {
            restored.push({
              id: nextMsgId(),
              role: "user",
              text: turn.user,
              time: new Date(),
            });
            if (turn.r_code && turn.r_code.length > 0) {
              for (const code of turn.r_code) {
                restored.push({
                  id: nextMsgId(),
                  role: "tool",
                  text: "Executed",
                  toolName: "R code",
                  toolArgs: { code: code.length > 200 ? code.slice(0, 200) + "..." : code },
                  toolStatus: "completed",
                  time: new Date(),
                });
              }
            }
            // Restore plot messages inline
            if (turn.plots && turn.plots.length > 0) {
              for (const dataUrl of turn.plots) {
                restored.push({
                  id: nextMsgId(),
                  role: "plot",
                  text: "",
                  time: new Date(),
                  imageSrc: dataUrl,
                });
              }
            }
            if (turn.assistant) {
              restored.push({
                id: nextMsgId(),
                role: "assistant",
                text: turn.assistant,
                time: new Date(),
              });
            }
          }
          setMessages(restored);
          console.log(`[chat] Restored ${turns.length} turns from history`);
        }
      } catch (e) {
        console.error("[chat] Failed to load history:", e);
      }
    })();
  }, [duckdbReady, sessionId]);

  async function handleStopChat(_accessToken?: string | undefined) {
    try {
      const token = await getAccessToken();
      await fetch(`${API}/chat/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (e) {
      console.error("[useAgentChat] handleStopChat failed:", e);
    }
    abortRef.current?.abort();
  }

  function handleClearChat() {
    setMessages([]);
    chatMemory.clearHistory(sessionId);
  }

  return {
    messages, setMessages,
    isTyping, setIsTyping,
    messagesEndRef,
    abortRef,
    queueMessage,
    handleStopChat,
    handleClearChat,
  };
}
