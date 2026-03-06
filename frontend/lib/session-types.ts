export type { ObjectRegistryEntry, DatasetMeta } from "@/lib/registry";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "plan" | "quota" | "plot";
  text: string;
  time: Date;
  toolName?: string;
  toolArgs?: Record<string, any>;
  toolStatus?: "running" | "completed";
  progress?: number;
  planSteps?: string[];
  planActive?: boolean;
  imageSrc?: string;
  askId?: string;
  askQuestion?: string;
  answered?: boolean;
  userPlan?: string;
  isStreaming?: boolean;
}

export interface RowsResponse {
  columns: string[];
  rows: any[][];
  total: number;
  page: number;
  per_page: number;
}

let _msgId = Date.now();
export function nextMsgId() { return `msg-${++_msgId}`; }
