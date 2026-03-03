import * as duckdb from "@duckdb/duckdb-wasm";

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<void> | null = null;
let _usingOPFS = false;
let _currentUserId: string | null = null;

// Debounced checkpoint: flushes WAL to OPFS file after writes
let _checkpointTimer: ReturnType<typeof setTimeout> | null = null;
let _quotaErrorFired = false;

function isQuotaError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === "QuotaExceededError") return true;
  const msg = String(e).toLowerCase();
  return msg.includes("quota") || msg.includes("storage") || msg.includes("full");
}

function emitQuotaError() {
  if (_quotaErrorFired) return; // only fire once per session
  _quotaErrorFired = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("duckdb-storage-error", {
        detail: "Browser storage is full. Your recent changes may not be saved. Try closing other tabs or clearing unused data.",
      })
    );
  }
}

function scheduleCheckpoint() {
  if (!_usingOPFS) return;
  if (_checkpointTimer) clearTimeout(_checkpointTimer);
  _checkpointTimer = setTimeout(async () => {
    try {
      if (conn) await conn.query("CHECKPOINT");
    } catch (e) {
      console.error("[duckdb] scheduleCheckpoint failed:", e);
      if (isQuotaError(e)) emitQuotaError();
    }
  }, 1000);
}

/** Force an immediate OPFS checkpoint (cancels any pending debounced one). */
export async function flushCheckpoint(): Promise<void> {
  if (!_usingOPFS || !conn) return;
  if (_checkpointTimer) {
    clearTimeout(_checkpointTimer);
    _checkpointTimer = null;
  }
  try {
    await conn.query("CHECKPOINT");
  } catch (e) {
    console.error("[duckdb] flushCheckpoint failed:", e);
    if (isQuotaError(e)) emitQuotaError();
  }
}

export async function initDuckDB(userId?: string): Promise<void> {
  // If already initialized for a different user, tear down and re-init
  if (db && userId && _currentUserId && userId !== _currentUserId) {
    console.log(`[duckdb] User switched ${_currentUserId} → ${userId}, re-initializing`);
    if (_checkpointTimer) { clearTimeout(_checkpointTimer); _checkpointTimer = null; }
    if (conn) { try { await conn.close(); } catch {} conn = null; }
    try { await db.terminate(); } catch {}
    db = null;
    initPromise = null;
    _usingOPFS = false;
    _currentUserId = null;
  }

  if (db) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);

    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], {
        type: "text/javascript",
      })
    );

    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger();
    db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    // Try OPFS for persistence across page reloads
    // Namespace by userId so each user gets isolated storage
    const opfsPath = userId
      ? `opfs://RBase_${userId}.duckdb`
      : null; // no userId → in-memory only

    if (opfsPath) {
      try {
        await db.open({
          path: opfsPath,
          accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
        });
        _usingOPFS = true;
        _currentUserId = userId!;
      } catch (e) {
        console.warn("OPFS persistence not available, using in-memory DuckDB:", e);
        _usingOPFS = false;
        _currentUserId = userId ?? null;
      }
    } else {
      _usingOPFS = false;
      _currentUserId = null;
    }

    conn = await db.connect();

    // Ensure all tables live in the 'main' schema regardless of OPFS filename
    if (_usingOPFS) {
      await conn.query(`USE main`);
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _datasets (
        id VARCHAR PRIMARY KEY,
        table_name VARCHAR NOT NULL,
        filename VARCHAR NOT NULL,
        columns VARCHAR[] NOT NULL DEFAULT [],
        row_count INTEGER NOT NULL DEFAULT 0,
        file_size_bytes BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _sessions (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL,
        history JSON DEFAULT '[]',
        created_at TIMESTAMP NOT NULL DEFAULT now(),
        updated_at TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _session_datasets (
        session_id VARCHAR NOT NULL,
        dataset_id VARCHAR NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        r_name VARCHAR,
        PRIMARY KEY (session_id, dataset_id)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _chat_history (
        session_id TEXT NOT NULL,
        turn_index INTEGER NOT NULL,
        user_msg TEXT NOT NULL,
        assistant_msg TEXT NOT NULL,
        r_code TEXT,
        created_at TIMESTAMP DEFAULT current_timestamp,
        PRIMARY KEY (session_id, turn_index)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _r_code_history (
        session_id VARCHAR NOT NULL,
        seq INTEGER NOT NULL,
        code TEXT NOT NULL,
        source VARCHAR NOT NULL,
        created_at TIMESTAMP DEFAULT current_timestamp,
        PRIMARY KEY (session_id, seq)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _rdata_blobs (
        session_id VARCHAR NOT NULL,
        filename VARCHAR NOT NULL,
        blob BLOB NOT NULL,
        created_at TIMESTAMP DEFAULT current_timestamp,
        PRIMARY KEY (session_id, filename)
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS _plot_store (
        session_id VARCHAR NOT NULL,
        plot_id VARCHAR NOT NULL,
        data_url TEXT NOT NULL,
        source VARCHAR NOT NULL,
        timestamp BIGINT NOT NULL,
        code TEXT,
        PRIMARY KEY (session_id, plot_id)
      )
    `);

    // Add plots column to _chat_history (for existing installs)
    try {
      await conn.query(`ALTER TABLE _chat_history ADD COLUMN plots TEXT`);
    } catch {
      // Column already exists — ignore
    }

    // Migration for existing databases: add r_name column if missing
    try {
      await conn.query(`ALTER TABLE _session_datasets ADD COLUMN r_name VARCHAR`);
    } catch {
      // Column already exists — ignore
    }

    // Checkpoint after initial table creation (no-op if tables already existed)
    scheduleCheckpoint();
  })();

  return initPromise;
}

function getConn(): duckdb.AsyncDuckDBConnection {
  if (!conn) throw new Error("DuckDB not initialized");
  return conn;
}

function getDB(): duckdb.AsyncDuckDB {
  if (!db) throw new Error("DuckDB not initialized");
  return db;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
}

/** Convert DuckDB-Wasm Arrow values to plain JS types. */
function toJsValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  // BIGINT / TIMESTAMP come back as BigInt
  if (typeof val === "bigint") return Number(val);
  // DATE / TIMESTAMP columns come back as native JS Date objects
  if (val instanceof Date) {
    // Check if it has a meaningful time component (timestamp) or is date-only
    const h = val.getUTCHours(), m = val.getUTCMinutes(), s = val.getUTCSeconds(), ms = val.getUTCMilliseconds();
    if (h === 0 && m === 0 && s === 0 && ms === 0) {
      // Date-only: "2004-12-31"
      return val.toISOString().slice(0, 10);
    }
    // Timestamp: "2004-12-31 14:30:00"
    return val.toISOString().slice(0, 19).replace("T", " ");
  }
  // VARCHAR[] and other LIST types come back as Arrow Vectors with toArray()
  if (val && typeof val === "object" && typeof (val as any).toArray === "function") {
    return Array.from((val as any).toArray()).map(toJsValue);
  }
  return val;
}

export async function queryDuckDB(sql: string): Promise<QueryResult> {
  const c = getConn();
  const result = await c.query(sql);
  const columns = result.schema.fields.map((f) => f.name);
  const rows: unknown[][] = [];
  for (let i = 0; i < result.numRows; i++) {
    const row: unknown[] = [];
    for (const col of columns) {
      const vec = result.getChild(col);
      row.push(toJsValue(vec?.get(i) ?? null));
    }
    rows.push(row);
  }

  // Auto-checkpoint after write operations
  const upper = sql.trimStart().substring(0, 7).toUpperCase();
  if (
    upper.startsWith("INSERT") ||
    upper.startsWith("UPDATE") ||
    upper.startsWith("DELETE") ||
    upper.startsWith("CREATE") ||
    upper.startsWith("DROP")
  ) {
    scheduleCheckpoint();
  }

  return { columns, rows, rowCount: result.numRows };
}

export async function importCSV(
  tableName: string,
  csvBytes: Uint8Array
): Promise<{ columns: string[]; rowCount: number }> {
  const d = getDB();
  const c = getConn();

  await d.registerFileBuffer(`${tableName}.csv`, csvBytes);
  await c.query(
    `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${tableName}.csv')`
  );
  await d.dropFile(`${tableName}.csv`);

  const metaResult = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName}' ORDER BY ordinal_position`
  );
  const columns: string[] = [];
  const colVec = metaResult.getChild("column_name");
  if (colVec) {
    for (let i = 0; i < metaResult.numRows; i++) {
      columns.push(String(toJsValue(colVec.get(i))));
    }
  }

  const countResult = await c.query(
    `SELECT count(*)::INTEGER as cnt FROM "${tableName}"`
  );
  const cntVec = countResult.getChild("cnt");
  const rowCount = cntVec ? Number(toJsValue(cntVec.get(0)) ?? 0) : 0;

  scheduleCheckpoint();

  return { columns, rowCount };
}

export async function importParquet(
  tableName: string,
  bytes: Uint8Array
): Promise<{ columns: string[]; rowCount: number }> {
  const d = getDB();
  const c = getConn();

  await d.registerFileBuffer(`${tableName}.parquet`, bytes);
  await c.query(
    `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_parquet('${tableName}.parquet')`
  );
  await d.dropFile(`${tableName}.parquet`);

  const metaResult = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName}' ORDER BY ordinal_position`
  );
  const columns: string[] = [];
  const colVec = metaResult.getChild("column_name");
  if (colVec) {
    for (let i = 0; i < metaResult.numRows; i++) {
      columns.push(String(toJsValue(colVec.get(i))));
    }
  }

  const countResult = await c.query(
    `SELECT count(*)::INTEGER as cnt FROM "${tableName}"`
  );
  const cntVec = countResult.getChild("cnt");
  const rowCount = cntVec ? Number(toJsValue(cntVec.get(0)) ?? 0) : 0;

  scheduleCheckpoint();

  return { columns, rowCount };
}

export interface RowsResponse {
  columns: string[];
  rows: unknown[][];
  total: number;
  page: number;
  per_page: number;
}

export async function getTableRows(
  tableName: string,
  page: number = 1,
  perPage: number = 50,
  sortCol?: string,
  sortDir?: "asc" | "desc"
): Promise<RowsResponse> {
  const c = getConn();
  const offset = (page - 1) * perPage;

  // Discover date/timestamp columns so we can CAST them for display
  const typesResult = await c.query(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tableName.replace(/'/g, "''")}' ORDER BY ordinal_position`
  );
  const dateCols = new Set<string>();
  const tsCols = new Set<string>();
  const typeNameVec = typesResult.getChild("column_name");
  const typeDataVec = typesResult.getChild("data_type");
  if (typeNameVec && typeDataVec) {
    for (let i = 0; i < typesResult.numRows; i++) {
      const colName = String(typeNameVec.get(i));
      const dtype = String(typeDataVec.get(i)).toUpperCase();
      if (dtype === "DATE") dateCols.add(colName);
      else if (dtype.includes("TIMESTAMP")) tsCols.add(colName);
    }
  }

  // Build SELECT with date/timestamp columns cast to VARCHAR for display
  let selectExpr = "*";
  if (dateCols.size > 0 || tsCols.size > 0) {
    const metaResult = await c.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName.replace(/'/g, "''")}' ORDER BY ordinal_position`
    );
    const allCols: string[] = [];
    const colVec = metaResult.getChild("column_name");
    if (colVec) {
      for (let i = 0; i < metaResult.numRows; i++) allCols.push(String(colVec.get(i)));
    }
    selectExpr = allCols.map((col) => {
      if (dateCols.has(col)) return `CAST("${col}" AS VARCHAR) AS "${col}"`;
      if (tsCols.has(col)) return `STRFTIME("${col}", '%Y-%m-%d %H:%M:%S') AS "${col}"`;
      return `"${col}"`;
    }).join(", ");
  }

  const orderClause =
    sortCol ? `ORDER BY "${sortCol}" ${sortDir === "desc" ? "DESC" : "ASC"}` : "";

  const dataResult = await c.query(
    `SELECT ${selectExpr} FROM "${tableName}" ${orderClause} LIMIT ${perPage} OFFSET ${offset}`
  );
  const columns = dataResult.schema.fields.map((f) => f.name);
  const rows: unknown[][] = [];
  for (let i = 0; i < dataResult.numRows; i++) {
    const row: unknown[] = [];
    for (const col of columns) {
      const vec = dataResult.getChild(col);
      row.push(toJsValue(vec?.get(i) ?? null));
    }
    rows.push(row);
  }

  const countResult = await c.query(
    `SELECT count(*)::INTEGER as cnt FROM "${tableName}"`
  );
  const cntVec = countResult.getChild("cnt");
  const total = cntVec ? Number(toJsValue(cntVec?.get(0)) ?? 0) : 0;

  return { columns, rows, total, page, per_page: perPage };
}

export async function getTableMeta(
  tableName: string
): Promise<{ columns: string[]; rowCount: number }> {
  const c = getConn();

  const metaResult = await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = '${tableName}' ORDER BY ordinal_position`
  );
  const columns: string[] = [];
  const colVec = metaResult.getChild("column_name");
  if (colVec) {
    for (let i = 0; i < metaResult.numRows; i++) {
      columns.push(String(toJsValue(colVec.get(i))));
    }
  }

  const countResult = await c.query(
    `SELECT count(*)::INTEGER as cnt FROM "${tableName}"`
  );
  const cntVec = countResult.getChild("cnt");
  const rowCount = cntVec ? Number(toJsValue(cntVec.get(0)) ?? 0) : 0;

  return { columns, rowCount };
}

export async function dropTable(tableName: string): Promise<void> {
  const c = getConn();
  await c.query(`DROP TABLE IF EXISTS "${tableName}"`);
  scheduleCheckpoint();
}

export async function tableExists(tableName: string): Promise<boolean> {
  const c = getConn();
  const result = await c.query(
    `SELECT count(*)::INTEGER as cnt FROM information_schema.tables WHERE table_name = '${tableName}'`
  );
  const vec = result.getChild("cnt");
  return vec ? Number(vec.get(0)) > 0 : false;
}

export function isInitialized(): boolean {
  return db !== null && conn !== null;
}

export function isUsingOPFS(): boolean {
  return _usingOPFS;
}

export function getCurrentUserId(): string | null {
  return _currentUserId;
}

/**
 * Drop all user data (datasets, sessions, view tables) and wipe OPFS storage.
 * After calling this, the page should be reloaded.
 */
export async function clearAllData(): Promise<void> {
  // 1. Cancel any pending checkpoint timer
  if (_checkpointTimer) {
    clearTimeout(_checkpointTimer);
    _checkpointTimer = null;
  }

  // 2. Drop all tables, close connection, terminate DB
  if (conn) {
    try {
      const tables = await conn.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'`
      );
      const nameVec = tables.getChild("table_name");
      if (nameVec) {
        for (let i = 0; i < tables.numRows; i++) {
          const name = String(nameVec.get(i));
          try { await conn.query(`DROP TABLE IF EXISTS "${name}"`); } catch (e) {
            console.warn(`[clearAllData] Failed to drop table "${name}":`, e);
          }
        }
      }
    } catch (e) {
      console.warn("[clearAllData] Failed to enumerate/drop tables:", e);
    }
    try { await conn.close(); } catch {}
    conn = null;
  }

  if (db) {
    try { await db.terminate(); } catch {}
    db = null;
  }

  const userIdToClean = _currentUserId;
  initPromise = null;
  _usingOPFS = false;
  _currentUserId = null;

  // 3. Wait for worker to release OPFS file handles
  await new Promise((r) => setTimeout(r, 200));

  // 4. Delete OPFS entries matching this user's file (not other users' files)
  const prefix = userIdToClean ? `RBase_${userIdToClean}` : "RBase";
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const root = await navigator.storage.getDirectory();
      const entries: string[] = [];
      // @ts-expect-error -- entries() is available in Chrome/modern browsers
      for await (const [name] of root.entries()) {
        entries.push(name);
      }

      // Only target entries belonging to this user (or legacy unscoped file)
      const targets = entries.filter((name) => name.startsWith(prefix));
      if (targets.length === 0) {
        console.log("[clearAllData] No OPFS entries for this user.");
        break;
      }

      console.log(`[clearAllData] Attempt ${attempt}: removing ${targets.length} OPFS entries:`, targets);
      for (const name of targets) {
        try {
          await root.removeEntry(name, { recursive: true });
        } catch (e) {
          console.warn(`[clearAllData] Failed to remove OPFS entry "${name}":`, e);
        }
      }

      // Verify deletion
      const remaining: string[] = [];
      // @ts-expect-error
      for await (const [name] of root.entries()) {
        if (name.startsWith(prefix)) remaining.push(name);
      }
      if (remaining.length === 0) {
        console.log("[clearAllData] OPFS fully cleared for user.");
        break;
      }

      if (attempt < MAX_RETRIES) {
        console.warn(`[clearAllData] ${remaining.length} entries remain, retrying after delay...`);
        await new Promise((r) => setTimeout(r, 200));
      } else {
        console.error(`[clearAllData] OPFS entries still remain after ${MAX_RETRIES} attempts:`, remaining);
      }
    } catch (e) {
      console.error("[clearAllData] OPFS cleanup error:", e);
      break;
    }
  }
}
