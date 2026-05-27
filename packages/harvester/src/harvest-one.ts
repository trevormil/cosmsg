#!/usr/bin/env bun
/**
 * Worker: harvest ONE chain and write its catalog. Run as an isolated child process by the
 * orchestrator (src/cli.ts) so a crash or hang from a flaky gRPC endpoint can't sink the
 * whole run. Exits 0 on success, non-zero on failure.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IndexEntry } from "@cosmsg/schema";
import { ALLOWLIST } from "./allowlist.js";
import { harvestChain, type Prefer } from "./harvest.js";

// A flaky endpoint can throw asynchronously from deep inside grpc-js/http2; turn that into a
// clean non-zero exit rather than letting it look like a success.
function die(e: unknown): never {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
process.on("uncaughtException", die);
process.on("unhandledRejection", die);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const chainName = argv.find((a) => !a.startsWith("--"));
  if (!chainName) die("usage: harvest-one <chain> [--prefer source|reflection] --data <dir>");
  let prefer: Prefer = "reflection";
  let dataDir = "data";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--prefer") {
      const v = argv[++i];
      if (v === "source" || v === "reflection") prefer = v;
    } else if (argv[i] === "--data") {
      dataDir = argv[++i] ?? dataDir;
    }
  }

  const spec = ALLOWLIST.find((s) => s.chainName === chainName) ?? {
    chainName: chainName!,
  };
  const catalog = await harvestChain(spec, prefer);

  const dir = join(dataDir, catalog.chainName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "msgs.json"), JSON.stringify(catalog.msgs, null, 2));
  await writeFile(
    join(dir, "queries.json"),
    JSON.stringify(catalog.queries, null, 2),
  );
  const meta: IndexEntry = {
    chainName: catalog.chainName,
    prettyName: catalog.prettyName,
    chainId: catalog.chainId,
    msgCount: catalog.msgs.length,
    queryCount: catalog.queries.length,
    provenance: catalog.provenance,
  };
  await writeFile(join(dir, "_meta.json"), JSON.stringify(meta, null, 2));

  console.log(
    `${catalog.msgs.length} msgs, ${catalog.queries.length} queries, via ${catalog.provenance.source}`,
  );
}

main().catch(die);
