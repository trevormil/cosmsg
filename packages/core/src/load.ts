import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ChainCatalog,
  DatasetIndex,
  type MsgDef,
  type QueryDef,
} from "@cosmsg/schema";

export interface Dataset {
  index: DatasetIndex;
  catalogs: Record<string, ChainCatalog>;
}

/**
 * Load the full dataset from a data directory (data/index.json + data/<chain>/{msgs,queries}.json).
 * Node-only (uses fs); browser/worker consumers should use a generated bundle instead.
 */
export function loadDatasetFromDir(dataDir: string): Dataset {
  const index = DatasetIndex.parse(
    JSON.parse(readFileSync(join(dataDir, "index.json"), "utf8")),
  );
  const catalogs: Record<string, ChainCatalog> = {};
  for (const entry of index.chains) {
    const msgs = JSON.parse(
      readFileSync(join(dataDir, entry.chainName, "msgs.json"), "utf8"),
    ) as MsgDef[];
    const queries = JSON.parse(
      readFileSync(join(dataDir, entry.chainName, "queries.json"), "utf8"),
    ) as QueryDef[];
    catalogs[entry.chainName] = ChainCatalog.parse({
      chainName: entry.chainName,
      prettyName: entry.prettyName,
      chainId: entry.chainId,
      provenance: entry.provenance,
      msgs,
      queries,
    });
  }
  return { index, catalogs };
}
