import { queryDuckDB } from "@/lib/duckdb";

export async function getPreference(key: string): Promise<string | null> {
  const result = await queryDuckDB(
    `SELECT value FROM _user_preferences WHERE key = '${key.replace(/'/g, "''")}'`
  );
  return result.rows.length > 0 ? String(result.rows[0][0]) : null;
}

export async function setPreference(key: string, value: string): Promise<void> {
  const safeKey = key.replace(/'/g, "''");
  const safeValue = value.replace(/'/g, "''");
  await queryDuckDB(
    `INSERT INTO _user_preferences (key, value) VALUES ('${safeKey}', '${safeValue}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
  );
}
