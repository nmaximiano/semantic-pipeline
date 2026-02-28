/**
 * Chat memory stored in DuckDB.
 * Keeps per-session conversation history for the agent.
 * The _chat_history table is created in initDuckDB().
 */
import { queryDuckDB } from "./duckdb";

export interface ChatTurn {
  user: string;
  assistant: string;
  r_code?: string[];
  plots?: string[]; // base64 data URLs for plot images produced during this turn
}

const MAX_TURNS = 20;

/** Get conversation history for a session. */
export async function getHistory(sessionId: string): Promise<ChatTurn[]> {
  const result = await queryDuckDB(`
    SELECT user_msg, assistant_msg, r_code, plots
    FROM _chat_history
    WHERE session_id = '${sessionId}'
    ORDER BY turn_index ASC
  `);
  return result.rows.map((row) => ({
    user: row[0] as string,
    assistant: row[1] as string,
    r_code: row[2] ? JSON.parse(row[2] as string) : undefined,
    plots: row[3] ? JSON.parse(row[3] as string) : undefined,
  }));
}

/** Append a turn to the session history. Trims to MAX_TURNS. */
export async function appendTurn(
  sessionId: string,
  userMsg: string,
  assistantMsg: string,
  rCode?: string[],
  plots?: string[]
): Promise<void> {
  // Get next turn index
  const countResult = await queryDuckDB(`
    SELECT COALESCE(MAX(turn_index), -1) + 1 AS next_idx
    FROM _chat_history
    WHERE session_id = '${sessionId}'
  `);
  const nextIdx = countResult.rows[0][0] as number;

  const escapedUser = userMsg.replace(/'/g, "''");
  const escapedAssistant = assistantMsg.replace(/'/g, "''");
  const rCodeJson = rCode ? JSON.stringify(rCode).replace(/'/g, "''") : null;
  const plotsJson = plots && plots.length > 0 ? JSON.stringify(plots).replace(/'/g, "''") : null;

  await queryDuckDB(`
    INSERT INTO _chat_history (session_id, turn_index, user_msg, assistant_msg, r_code, plots)
    VALUES ('${sessionId}', ${nextIdx}, '${escapedUser}', '${escapedAssistant}', ${rCodeJson ? `'${rCodeJson}'` : "NULL"}, ${plotsJson ? `'${plotsJson}'` : "NULL"})
  `);

  // Trim old turns beyond MAX_TURNS
  if (nextIdx >= MAX_TURNS) {
    const cutoff = nextIdx - MAX_TURNS + 1;
    await queryDuckDB(`
      DELETE FROM _chat_history
      WHERE session_id = '${sessionId}' AND turn_index < ${cutoff}
    `);
  }
}

/** Clear history for a session. */
export async function clearHistory(sessionId: string): Promise<void> {
  await queryDuckDB(`
    DELETE FROM _chat_history WHERE session_id = '${sessionId}'
  `);
}
