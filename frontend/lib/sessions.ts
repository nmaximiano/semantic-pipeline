import { queryDuckDB, dropTable, flushCheckpoint } from "./duckdb";

export interface SessionMeta {
  id: string;
  name: string;
  dataset_count: number;
  dataset_names: string[];
  created_at: string;
  updated_at: string;
}

export interface SessionDetail {
  id: string;
  name: string;
  datasets: SessionDataset[];
  created_at: string;
  updated_at: string;
}

export interface SessionDataset {
  id: string;
  filename: string;
  columns: string[];
  row_count: number;
  file_size_bytes: number;
  display_order: number;
  r_name: string | null;
}

function generateId(): string {
  return crypto.randomUUID();
}

export async function createSession(
  name: string,
  datasetIds: string[] = []
): Promise<string> {
  const id = generateId();
  const now = new Date().toISOString();

  await queryDuckDB(`
    INSERT INTO _sessions (id, name, created_at, updated_at)
    VALUES ('${id}', '${name.replace(/'/g, "''")}', '${now}', '${now}')
  `);

  for (let i = 0; i < datasetIds.length; i++) {
    await queryDuckDB(`
      INSERT INTO _session_datasets (session_id, dataset_id, display_order)
      VALUES ('${id}', '${datasetIds[i]}', ${i})
    `);
  }

  return id;
}

export async function listSessions(): Promise<SessionMeta[]> {
  const result = await queryDuckDB(`
    SELECT
      s.id,
      s.name,
      s.created_at::VARCHAR as created_at,
      s.updated_at::VARCHAR as updated_at,
      COUNT(sd.dataset_id)::INTEGER as dataset_count,
      COALESCE(STRING_AGG(d.filename, ', ' ORDER BY sd.display_order), '') as dataset_names
    FROM _sessions s
    LEFT JOIN _session_datasets sd ON s.id = sd.session_id
    LEFT JOIN _datasets d ON sd.dataset_id = d.id
    GROUP BY s.id, s.name, s.created_at, s.updated_at
    ORDER BY s.updated_at DESC
  `);

  return result.rows.map((row) => ({
    id: String(row[0]),
    name: String(row[1]),
    created_at: String(row[2]),
    updated_at: String(row[3]),
    dataset_count: Number(row[4]),
    dataset_names: String(row[5])
      .split(", ")
      .filter(Boolean),
  }));
}

export async function getSession(id: string): Promise<SessionDetail | null> {
  const sessionResult = await queryDuckDB(`
    SELECT id, name, created_at::VARCHAR as created_at, updated_at::VARCHAR as updated_at
    FROM _sessions WHERE id = '${id}'
  `);

  if (sessionResult.rows.length === 0) return null;
  const row = sessionResult.rows[0];

  const datasetsResult = await queryDuckDB(`
    SELECT d.id, d.filename, d.columns, d.row_count, d.file_size_bytes, sd.display_order, sd.r_name
    FROM _session_datasets sd
    JOIN _datasets d ON sd.dataset_id = d.id
    WHERE sd.session_id = '${id}'
    ORDER BY sd.display_order
  `);

  const datasets: SessionDataset[] = datasetsResult.rows.map((r) => ({
    id: String(r[0]),
    filename: String(r[1]),
    columns: Array.isArray(r[2]) ? (r[2] as string[]) : [],
    row_count: Number(r[3]),
    file_size_bytes: Number(r[4]),
    display_order: Number(r[5]),
    r_name: r[6] != null ? String(r[6]) : null,
  }));

  return {
    id: String(row[0]),
    name: String(row[1]),
    created_at: String(row[2]),
    updated_at: String(row[3]),
    datasets,
  };
}

export async function deleteSession(id: string): Promise<void> {
  // 1. Find all datasets + table names belonging to this session
  const dsResult = await queryDuckDB(`
    SELECT d.id, d.table_name
    FROM _session_datasets sd
    JOIN _datasets d ON sd.dataset_id = d.id
    WHERE sd.session_id = '${id}'
  `);

  // 2. Drop each dataset's DuckDB data table and _rview_ table, then delete metadata
  for (const row of dsResult.rows) {
    const datasetId = String(row[0]);
    const tableName = String(row[1]);
    await dropTable(tableName);
    // Also drop any view table created by the R environment
    const viewTable = `_rview_${datasetId.replace(/-/g, "_")}`;
    try { await queryDuckDB(`DROP TABLE IF EXISTS "${viewTable}"`); } catch {}
    await queryDuckDB(`DELETE FROM _datasets WHERE id = '${datasetId}'`);
  }

  // 3. Clean up session-scoped auxiliary tables
  await queryDuckDB(`DELETE FROM _rdata_blobs WHERE session_id = '${id}'`);
  await queryDuckDB(`DELETE FROM _r_code_history WHERE session_id = '${id}'`);
  await queryDuckDB(`DELETE FROM _chat_history WHERE session_id = '${id}'`);
  await queryDuckDB(`DELETE FROM _plot_store WHERE session_id = '${id}'`);

  // 4. Delete join rows and session row
  await queryDuckDB(`DELETE FROM _session_datasets WHERE session_id = '${id}'`);
  await queryDuckDB(`DELETE FROM _sessions WHERE id = '${id}'`);
}

export async function renameSession(
  id: string,
  newName: string
): Promise<void> {
  const now = new Date().toISOString();
  await queryDuckDB(`
    UPDATE _sessions
    SET name = '${newName.replace(/'/g, "''")}', updated_at = '${now}'
    WHERE id = '${id}'
  `);
}

export async function addDatasetToSession(
  sessionId: string,
  datasetId: string,
  rName?: string
): Promise<void> {
  const maxOrderResult = await queryDuckDB(`
    SELECT COALESCE(MAX(display_order), -1)::INTEGER as max_order
    FROM _session_datasets WHERE session_id = '${sessionId}'
  `);
  const maxOrder = Number(maxOrderResult.rows[0]?.[0] ?? -1);

  const rNameVal = rName ? `'${rName.replace(/'/g, "''")}'` : "NULL";
  await queryDuckDB(`
    INSERT INTO _session_datasets (session_id, dataset_id, display_order, r_name)
    VALUES ('${sessionId}', '${datasetId}', ${maxOrder + 1}, ${rNameVal})
    ON CONFLICT DO NOTHING
  `);

  const now = new Date().toISOString();
  await queryDuckDB(
    `UPDATE _sessions SET updated_at = '${now}' WHERE id = '${sessionId}'`
  );
}

export async function removeDatasetFromSession(
  sessionId: string,
  datasetId: string
): Promise<void> {
  await queryDuckDB(`
    DELETE FROM _session_datasets
    WHERE session_id = '${sessionId}' AND dataset_id = '${datasetId}'
  `);

  const now = new Date().toISOString();
  await queryDuckDB(
    `UPDATE _sessions SET updated_at = '${now}' WHERE id = '${sessionId}'`
  );
}

export async function updateSessionDatasetRName(
  sessionId: string,
  datasetId: string,
  rName: string
): Promise<void> {
  await queryDuckDB(`
    UPDATE _session_datasets
    SET r_name = '${rName.replace(/'/g, "''")}'
    WHERE session_id = '${sessionId}' AND dataset_id = '${datasetId}'
  `);
  // Force immediate OPFS checkpoint so renames survive page reload
  await flushCheckpoint();

  // Read-back verification
  try {
    const verify = await queryDuckDB(`
      SELECT r_name FROM _session_datasets
      WHERE session_id = '${sessionId}' AND dataset_id = '${datasetId}'
    `);
    const persisted = verify.rows.length > 0 ? verify.rows[0][0] : null;
    if (persisted === rName) {
      console.log(`[sessions] r_name verified: "${rName}" for dataset ${datasetId}`);
    } else {
      console.error(`[sessions] r_name MISMATCH: expected "${rName}", got "${persisted}" for dataset ${datasetId}`);
    }
  } catch (e) {
    console.error("[sessions] r_name verification query failed:", e);
  }
}

export async function touchSession(sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  await queryDuckDB(
    `UPDATE _sessions SET updated_at = '${now}' WHERE id = '${sessionId}'`
  );
}
