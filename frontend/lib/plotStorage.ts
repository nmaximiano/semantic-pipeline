/**
 * Persistent plot storage backed by DuckDB.
 * Stores sidebar plot images (base64 data URLs) per session.
 */
import { queryDuckDB } from "./duckdb";
import type { StoredPlot } from "./usePlotStore";

/** Load all plots for a session, ordered by timestamp. */
export async function getPlots(sessionId: string): Promise<StoredPlot[]> {
  const result = await queryDuckDB(`
    SELECT plot_id, data_url, source, timestamp, code
    FROM _plot_store
    WHERE session_id = '${sessionId}'
    ORDER BY timestamp ASC
  `);
  return result.rows.map((row) => ({
    id: row[0] as string,
    dataUrl: row[1] as string,
    source: row[2] as "user" | "agent",
    timestamp: row[3] as number,
    code: (row[4] as string) || undefined,
  }));
}

/** Persist one or more plots for a session. */
export async function savePlots(
  sessionId: string,
  plots: StoredPlot[]
): Promise<void> {
  for (const p of plots) {
    const escapedUrl = p.dataUrl.replace(/'/g, "''");
    const escapedCode = p.code ? `'${p.code.replace(/'/g, "''")}'` : "NULL";
    await queryDuckDB(`
      INSERT OR REPLACE INTO _plot_store (session_id, plot_id, data_url, source, timestamp, code)
      VALUES ('${sessionId}', '${p.id}', '${escapedUrl}', '${p.source}', ${p.timestamp}, ${escapedCode})
    `);
  }
}

/** Clear all plots for a session. */
export async function clearPlots(sessionId: string): Promise<void> {
  await queryDuckDB(`DELETE FROM _plot_store WHERE session_id = '${sessionId}'`);
}
