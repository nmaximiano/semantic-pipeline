import { queryDuckDB } from "./duckdb";
import { evalR, getWebR } from "./webr";
import type { RObject, RList } from "webr";

/**
 * Load a DuckDB table into R's global environment as a data.frame.
 * Queries all rows from DuckDB, builds column vectors via WebR,
 * then combines into a data.frame bound to `rName` in R.
 *
 * @param tableName  DuckDB table to read from
 * @param rName      R variable name to bind to (defaults to tableName)
 */
export async function loadTableIntoR(
  tableName: string,
  rName?: string
): Promise<void> {
  const webR = getWebR();
  if (!webR) throw new Error("WebR not initialized");
  const varName = rName ?? tableName;
  console.log(`[bridge] loadTableIntoR: "${tableName}" -> R var "${varName}"`);

  // Query column types so we can restore date/timestamp types in R
  const typesResult = await queryDuckDB(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${tableName.replace(/'/g, "''")}' ORDER BY ordinal_position`
  );
  const colTypes = new Map<string, string>();
  for (const row of typesResult.rows) {
    colTypes.set(String(row[0]), String(row[1]).toUpperCase());
  }

  const result = await queryDuckDB(`SELECT * FROM "${tableName}"`);
  if (result.columns.length === 0) return;

  const shelter = await new webR.Shelter();

  try {
    const rColumns: Record<string, RObject> = {};
    // Track which R column indices (1-based) need Date/POSIXct conversion
    const dateColIndices: number[] = [];
    const tsColIndices: number[] = [];

    for (let colIdx = 0; colIdx < result.columns.length; colIdx++) {
      const colName = result.columns[colIdx];
      const dtype = colTypes.get(colName)?.toUpperCase() ?? "";
      const values = result.rows.map((row) => row[colIdx]);

      const allNull = values.every((v) => v === null || v === undefined);
      if (allNull) {
        rColumns[colName] = await new shelter.RCharacter(
          values.map(() => null)
        );
        continue;
      }

      // DATE / TIMESTAMP: convert to ISO strings in JS so R gets clean character data
      if (dtype === "DATE") {
        dateColIndices.push(colIdx + 1); // R is 1-indexed
        rColumns[colName] = await new shelter.RCharacter(
          values.map((v) => {
            if (v === null || v === undefined) return null;
            if (typeof v === "string") return v; // already ISO string from toJsValue
            const d = new Date(Number(v));
            return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
          })
        );
        continue;
      }
      if (dtype.includes("TIMESTAMP")) {
        tsColIndices.push(colIdx + 1);
        rColumns[colName] = await new shelter.RCharacter(
          values.map((v) => {
            if (v === null || v === undefined) return null;
            if (typeof v === "string") return v;
            const d = new Date(Number(v));
            return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace("T", " ");
          })
        );
        continue;
      }

      const firstNonNull = values.find(
        (v) => v !== null && v !== undefined
      );
      if (typeof firstNonNull === "number") {
        rColumns[colName] = await new shelter.RDouble(
          values.map((v) => (v === null || v === undefined ? null : Number(v)))
        );
      } else if (typeof firstNonNull === "bigint") {
        rColumns[colName] = await new shelter.RDouble(
          values.map((v) =>
            v === null || v === undefined ? null : Number(v)
          )
        );
      } else if (typeof firstNonNull === "boolean") {
        rColumns[colName] = await new shelter.RLogical(
          values.map((v) => (v === null || v === undefined ? null : Boolean(v)))
        );
      } else {
        rColumns[colName] = await new shelter.RCharacter(
          values.map((v) =>
            v === null || v === undefined ? null : String(v)
          )
        );
      }
    }

    const rList = (await new shelter.RList(rColumns)) as RList;
    await webR.objs.globalEnv.bind(varName, rList);

    await shelter.captureR(
      `\`${varName}\` <- as.data.frame(\`${varName}\`, stringsAsFactors = FALSE)`
    );

    // Convert date/timestamp columns from ISO strings to R Date/POSIXct.
    // We use column indices (not names) because as.data.frame() sanitizes
    // names (e.g. " Air Date" → "Air.Date"), making name-based lookup fail.
    const dateConversions: string[] = [];
    for (const idx of dateColIndices) {
      dateConversions.push(
        `tryCatch(\`${varName}\`[[${idx}]] <- as.Date(\`${varName}\`[[${idx}]]), error = function(e) NULL)`
      );
    }
    for (const idx of tsColIndices) {
      dateConversions.push(
        `tryCatch(\`${varName}\`[[${idx}]] <- as.POSIXct(\`${varName}\`[[${idx}]], tz = "UTC"), error = function(e) NULL)`
      );
    }

    if (dateConversions.length > 0) {
      console.log(`[bridge] Converting ${dateConversions.length} date/timestamp columns for "${varName}"`);
      await shelter.captureR(dateConversions.join("\n"));
    }

    shelter.purge();
  } catch (err) {
    shelter.purge();
    throw err;
  }
}

/**
 * Extract an R data.frame from R's global environment and save it
 * as a DuckDB table, replacing any existing table with that name.
 */
export async function saveRFrameToDuckDB(
  rVarName: string,
  tableName: string
): Promise<{ columns: string[]; rowCount: number }> {
  const webR = getWebR();
  if (!webR) throw new Error("WebR not initialized");

  const shelter = await new webR.Shelter();

  try {
    const colNamesResult = await shelter.captureR(
      `cat(paste(colnames(${rVarName}), collapse="\\t"))`
    );
    const colNamesLine =
      colNamesResult.output
        .filter((o) => o.type === "stdout")
        .map((o) => o.data as string)
        .join("") || "";
    const columns = colNamesLine.split("\t").filter(Boolean);

    const nrowResult = await shelter.captureR(`cat(nrow(${rVarName}))`);
    const nrowStr =
      nrowResult.output
        .filter((o) => o.type === "stdout")
        .map((o) => o.data as string)
        .join("") || "0";
    const rowCount = parseInt(nrowStr, 10);

    if (columns.length === 0 || rowCount === 0) {
      shelter.purge();
      return { columns, rowCount: 0 };
    }

    // Convert Date/POSIXct columns to ISO character strings before CSV export,
    // then use write.csv to a tempfile and read it back as a single string.
    // This avoids stdout capture issues between shelter.captureR and capture.output.
    const csvResult = await evalR(
      `local({
        tmp <- ${rVarName}
        for (col in names(tmp)) {
          if (inherits(tmp[[col]], "POSIXct") || inherits(tmp[[col]], "POSIXlt")) {
            tmp[[col]] <- format(tmp[[col]], "%Y-%m-%d %H:%M:%S")
          } else if (inherits(tmp[[col]], "Date")) {
            tmp[[col]] <- format(tmp[[col]], "%Y-%m-%d")
          }
        }
        tf <- tempfile(fileext = ".csv")
        write.csv(tmp, tf, row.names = FALSE)
        cat(readLines(tf, warn = FALSE), sep = "\\n")
        unlink(tf)
      })`
    );
    const csvStr = csvResult.stdout || "";

    shelter.purge();

    if (!csvStr || csvResult.error) {
      throw new Error(csvResult.error || "Failed to export R data.frame to CSV");
    }

    // Import CSV string into DuckDB
    const { importCSV, dropTable } = await import("./duckdb");
    await dropTable(tableName);
    const encoder = new TextEncoder();
    const csvBytes = encoder.encode(csvStr);
    await importCSV(tableName, csvBytes);

    return { columns, rowCount };
  } catch (err) {
    shelter.purge();
    throw err;
  }
}

/**
 * Convenience: after R code modifies a data.frame, sync it back to DuckDB
 * and return fresh metadata.
 */
export async function syncRToDuckDB(
  rVarName: string,
  tableName: string
): Promise<{ columns: string[]; rowCount: number }> {
  return saveRFrameToDuckDB(rVarName, tableName);
}

/**
 * Execute R code that might modify data, then detect if the variable
 * was modified and sync back to DuckDB.
 */
export async function execAndSync(
  code: string,
  tableName: string,
  rVarName: string
): Promise<{
  stdout: string;
  stderr: string;
  images: ImageBitmap[];
  error: string | null;
  dataChanged: boolean;
}> {
  // Get row count before
  let preDigest = "";
  try {
    const pre = await evalR(
      `cat(nrow(${rVarName}), ncol(${rVarName}), paste(colnames(${rVarName}), collapse=","))`
    );
    preDigest = pre.stdout;
  } catch {
    // Variable might not exist yet
  }

  console.log(`[bridge] execAndSync: rVar="${rVarName}", table="${tableName}", preDigest="${preDigest}"`);
  const result = await evalR(code);

  // Safety net: if evalR missed an error but stderr contains one, promote it
  if (!result.error && result.stderr) {
    const stderrError = result.stderr.match(/Error(?:\s+in\s+[^:]*)?:\s*.+/);
    if (stderrError) {
      result.error = stderrError[0];
    }
  }

  console.log(`[bridge] execAndSync result: error=${result.error || "none"}, stdout=${(result.stdout || "").slice(0, 100)}`);

  let dataChanged = false;
  if (!result.error) {
    // Check if the variable still exists (might have been renamed/removed)
    const existsCheck = await evalR(`cat(exists("${rVarName}", envir = .GlobalEnv))`);
    const stillExists = existsCheck.stdout.trim() === "TRUE";

    if (stillExists) {
      try {
        const post = await evalR(
          `cat(nrow(${rVarName}), ncol(${rVarName}), paste(colnames(${rVarName}), collapse=","))`
        );
        if (post.stdout !== preDigest) {
          dataChanged = true;
          console.log(`[bridge] Data changed: "${preDigest}" -> "${post.stdout}". Syncing to DuckDB...`);
          await saveRFrameToDuckDB(rVarName, tableName);
        }
      } catch (e) {
        console.error(`[bridge] Error syncing "${rVarName}":`, e);
      }
    } else {
      // Variable was renamed/removed — mark as changed but don't try to sync old name
      dataChanged = true;
      console.log(`[bridge] Variable "${rVarName}" no longer exists after execution (renamed/removed)`);
    }
  }

  // Append environment snapshot to stdout for agent context
  if (!result.error) {
    try {
      const { listREnvironment } = await import("./webr");
      const envObjs = await listREnvironment();
      const dfSummaries = envObjs
        .filter((o) => o.isDataFrame)
        .map((o) => `${o.name}: ${o.nrow}x${o.ncol}`)
        .join(", ");
      if (dfSummaries) {
        result.stdout = (result.stdout || "") + `\n[ENV] ${dfSummaries}`;
      }
    } catch {}
  }

  return { ...result, dataChanged };
}
