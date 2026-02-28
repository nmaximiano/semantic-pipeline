/**
 * Object registry utilities — extracted from session page.
 * Maps R environment objects to DuckDB-backed datasets with stable IDs.
 */
import type { REnvObject } from "@/lib/webr";
import * as localSessions from "@/lib/sessions";

export interface ObjectRegistryEntry {
  stableId: string;
  rName: string;
  datasetId: string | null;
  isDataFrame: boolean;
  class: string;
  nrow?: number;
  ncol?: number;
  length?: number;
}

export interface DatasetMeta {
  id: string;
  filename: string;
  columns: string[];
  row_count: number;
  file_size_bytes: number;
  created_at: string;
  r_name: string | null;
}

export function getViewTableName(stableId: string): string {
  return `_rview_${stableId.replace(/-/g, "_")}`;
}

export function cleanRVarName(filename: string): string {
  let name = filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_]/g, "_");
  if (/^\d/.test(name)) name = "d_" + name;
  return name;
}

export function buildRegistry(
  envObjects: REnvObject[],
  sessionDatasets: DatasetMeta[],
  prevRegistry: Map<string, ObjectRegistryEntry>
): Map<string, ObjectRegistryEntry> {
  const registry = new Map<string, ObjectRegistryEntry>();
  const matchedEnvNames = new Set<string>();
  const matchedDatasetIds = new Set<string>();

  // Pass 1: Match env objects to session datasets by r_name (or filename-derived fallback)
  for (const obj of envObjects) {
    const ds = sessionDatasets.find(
      (d) => !matchedDatasetIds.has(d.id) && (d.r_name === obj.name || (!d.r_name && cleanRVarName(d.filename) === obj.name))
    );
    if (ds) {
      registry.set(ds.id, {
        stableId: ds.id,
        rName: obj.name,
        datasetId: ds.id,
        isDataFrame: obj.isDataFrame,
        class: obj.class,
        nrow: obj.nrow,
        ncol: obj.ncol,
        length: obj.length,
      });
      matchedEnvNames.add(obj.name);
      matchedDatasetIds.add(ds.id);
    }
  }

  // Pass 2: Match remaining env objects via prevRegistry (preserves stableId across renames)
  for (const obj of envObjects) {
    if (matchedEnvNames.has(obj.name)) continue;
    for (const [stableId, prev] of prevRegistry) {
      if (prev.rName === obj.name && !registry.has(stableId)) {
        registry.set(stableId, {
          stableId,
          rName: obj.name,
          datasetId: prev.datasetId,
          isDataFrame: obj.isDataFrame,
          class: obj.class,
          nrow: obj.nrow,
          ncol: obj.ncol,
          length: obj.length,
        });
        matchedEnvNames.add(obj.name);
        if (prev.datasetId) matchedDatasetIds.add(prev.datasetId);
        break;
      }
    }
  }

  // Pass 3: Detect renames — unmatched dataset whose old r_name disappeared,
  // paired with an unmatched new data.frame in the env.
  // Must run BEFORE ephemeral classification so renamed objects aren't lost.
  const unmatchedDatasets = sessionDatasets.filter(
    (d) => !matchedDatasetIds.has(d.id) && (() => {
      const effectiveName = d.r_name || cleanRVarName(d.filename);
      return effectiveName && !envObjects.some((o) => o.name === effectiveName);
    })()
  );
  const unmatchedEnvDfs = envObjects.filter(
    (o) => o.isDataFrame && !matchedEnvNames.has(o.name)
  );
  if (unmatchedDatasets.length === 1 && unmatchedEnvDfs.length === 1) {
    const ds = unmatchedDatasets[0];
    const obj = unmatchedEnvDfs[0];
    registry.set(ds.id, {
      stableId: ds.id,
      rName: obj.name,
      datasetId: ds.id,
      isDataFrame: obj.isDataFrame,
      class: obj.class,
      nrow: obj.nrow,
      ncol: obj.ncol,
      length: obj.length,
    });
    matchedEnvNames.add(obj.name);
    matchedDatasetIds.add(ds.id);
  } else if (unmatchedDatasets.length > 0 && unmatchedEnvDfs.length > 0) {
    // Multiple unmatched — try 1:1 matching by order
    const pairs = Math.min(unmatchedDatasets.length, unmatchedEnvDfs.length);
    for (let i = 0; i < pairs; i++) {
      const ds = unmatchedDatasets[i];
      const obj = unmatchedEnvDfs[i];
      if (!matchedEnvNames.has(obj.name)) {
        registry.set(ds.id, {
          stableId: ds.id,
          rName: obj.name,
          datasetId: ds.id,
          isDataFrame: obj.isDataFrame,
          class: obj.class,
          nrow: obj.nrow,
          ncol: obj.ncol,
          length: obj.length,
        });
        matchedEnvNames.add(obj.name);
        matchedDatasetIds.add(ds.id);
      }
    }
  }

  // Pass 4: Any remaining unmatched env objects become ephemeral
  for (const obj of envObjects) {
    if (matchedEnvNames.has(obj.name)) continue;
    const ephemeralId = "ephemeral_" + obj.name;
    registry.set(ephemeralId, {
      stableId: ephemeralId,
      rName: obj.name,
      datasetId: null,
      isDataFrame: obj.isDataFrame,
      class: obj.class,
      nrow: obj.nrow,
      ncol: obj.ncol,
      length: obj.length,
    });
  }

  return registry;
}

/**
 * Detect renames between two registries and persist them to DuckDB.
 * Returns the list of dataset IDs that were renamed (for React state updates).
 */
export async function persistRenames(
  sessionId: string,
  newRegistry: Map<string, ObjectRegistryEntry>,
  oldRegistry: Map<string, ObjectRegistryEntry>,
  setSessionDatasets: React.Dispatch<React.SetStateAction<DatasetMeta[]>>
): Promise<void> {
  for (const [stableId, entry] of newRegistry) {
    if (entry.datasetId) {
      const oldEntry = oldRegistry.get(stableId);
      if (oldEntry && oldEntry.rName !== entry.rName) {
        console.log(`[registry] Rename detected: "${oldEntry.rName}" -> "${entry.rName}"`);
        await localSessions.updateSessionDatasetRName(sessionId, entry.datasetId, entry.rName);
        setSessionDatasets((prev) =>
          prev.map((d) => d.id === entry.datasetId ? { ...d, r_name: entry.rName } : d)
        );
      }
    }
  }
}
