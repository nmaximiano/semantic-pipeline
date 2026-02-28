import { queryDuckDB } from "./duckdb";

/**
 * Store a raw .RData/.rds blob in DuckDB for reload persistence.
 */
export async function storeRDataBlob(
  sessionId: string,
  filename: string,
  bytes: Uint8Array
): Promise<void> {
  // Encode bytes as hex literal for DuckDB blob insertion
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  await queryDuckDB(
    `INSERT OR REPLACE INTO _rdata_blobs (session_id, filename, blob)
     VALUES ('${sessionId}', '${filename.replace(/'/g, "''")}', '\\x${hex}'::BLOB)`
  );
}

/**
 * Retrieve all .RData blobs for a session (for reload on page init).
 */
export async function getRDataBlobs(
  sessionId: string
): Promise<{ filename: string; blob: Uint8Array }[]> {
  const result = await queryDuckDB(
    `SELECT filename, blob FROM _rdata_blobs WHERE session_id = '${sessionId}' ORDER BY created_at`
  );
  return result.rows.map((row) => ({
    filename: String(row[0]),
    blob: row[1] instanceof Uint8Array ? row[1] : new Uint8Array(row[1] as ArrayBuffer),
  }));
}

/**
 * Clear all .RData blobs for a session (used by reset).
 */
export async function clearRDataBlobs(sessionId: string): Promise<void> {
  await queryDuckDB(
    `DELETE FROM _rdata_blobs WHERE session_id = '${sessionId}'`
  );
}
