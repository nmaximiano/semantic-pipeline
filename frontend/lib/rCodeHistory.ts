import { queryDuckDB } from "@/lib/duckdb";

export async function appendRCode(
  sessionId: string,
  code: string,
  source: "agent" | "user"
): Promise<void> {
  const result = await queryDuckDB(
    `SELECT COALESCE(MAX(seq), -1) + 1 AS next_seq FROM _r_code_history WHERE session_id = '${sessionId.replace(/'/g, "''")}'`
  );
  const nextSeq = Number(result.rows[0]?.[0] ?? 0);
  const escaped = code.replace(/'/g, "''");
  await queryDuckDB(
    `INSERT INTO _r_code_history (session_id, seq, code, source) VALUES ('${sessionId.replace(/'/g, "''")}', ${nextSeq}, '${escaped}', '${source}')`
  );
}

export interface RCodeEntry {
  seq: number;
  code: string;
  source: "agent" | "user";
}

export async function getRCodeHistory(sessionId: string): Promise<RCodeEntry[]> {
  const result = await queryDuckDB(
    `SELECT seq, code, source FROM _r_code_history WHERE session_id = '${sessionId.replace(/'/g, "''")}' ORDER BY seq`
  );
  return result.rows.map((row) => ({
    seq: Number(row[0]),
    code: String(row[1]),
    source: String(row[2]) as "agent" | "user",
  }));
}

export async function clearRCodeHistory(sessionId: string): Promise<void> {
  await queryDuckDB(
    `DELETE FROM _r_code_history WHERE session_id = '${sessionId.replace(/'/g, "''")}'`
  );
}
