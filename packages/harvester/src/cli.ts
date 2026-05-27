#!/usr/bin/env bun
/**
 * Orchestrator: harvest the allowlist by running one isolated worker process per chain
 * (src/harvest-one.ts), then assemble data/index.json from each chain's _meta.json.
 * Isolation keeps a single crashing/hanging gRPC endpoint from killing the whole run.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatasetIndex, IndexEntry } from "@cosmsg/schema";
import { ALLOWLIST } from "./allowlist.js";
import type { Prefer } from "./harvest.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "..", "..", "..", "data");
const WORKER = join(HERE, "harvest-one.ts");
const PER_CHAIN_TIMEOUT_MS = 240_000;

function parseArgs(argv: string[]): { prefer: Prefer; chains: string[] } {
  let prefer: Prefer = "reflection";
  const chains: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--prefer") {
      const v = argv[++i];
      if (v === "source" || v === "reflection") prefer = v;
    } else if (a === "--chains") {
      chains.push(...(argv[++i] ?? "").split(",").filter(Boolean));
    } else if (!a.startsWith("--")) {
      chains.push(a);
    }
  }
  return { prefer, chains };
}

async function runWorker(
  chainName: string,
  prefer: Prefer,
): Promise<{ ok: boolean; note: string }> {
  const proc = Bun.spawn(
    ["bun", "run", WORKER, chainName, "--prefer", prefer, "--data", DATA_DIR],
    { stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), PER_CHAIN_TIMEOUT_MS);
  try {
    const code = await proc.exited;
    const out = (await new Response(proc.stdout).text()).trim();
    const err = (await new Response(proc.stderr).text()).trim();
    return code === 0
      ? { ok: true, note: out }
      : { ok: false, note: err || out || `exit ${code}` };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const { prefer, chains } = parseArgs(process.argv.slice(2));
  const names = chains.length ? chains : ALLOWLIST.map((s) => s.chainName);

  console.log(`Harvesting ${names.length} chain(s), prefer=${prefer} -> ${DATA_DIR}`);

  const other: Prefer = prefer === "reflection" ? "source" : "reflection";
  let succeeded = 0;
  let failures = 0;
  for (const name of names) {
    process.stdout.write(`- ${name} ... `);
    let { ok, note } = await runWorker(name, prefer);
    // Hybrid: if the preferred source fails (dead endpoints, HTTP/1.1 servers that crash
    // grpc-js, malformed descriptors), retry once with the other source.
    if (!ok) {
      const retry = await runWorker(name, other);
      if (retry.ok) ({ ok, note } = retry);
    }
    if (ok) {
      succeeded++;
      console.log(`ok (${note})`);
    } else {
      failures++;
      console.log(`FAILED: ${note.split("\n").slice(-1)[0]}`);
    }
  }

  // Rebuild the index from every chain present on disk (not just this run's chains), so a
  // subset harvest refreshes those chains without dropping the rest from index.json.
  const entries: IndexEntry[] = [];
  const dirs = await readdir(DATA_DIR, { withFileTypes: true });
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    try {
      const raw = await readFile(join(DATA_DIR, d.name, "_meta.json"), "utf8");
      entries.push(IndexEntry.parse(JSON.parse(raw)));
    } catch {
      /* skip dirs without a readable _meta.json */
    }
  }
  entries.sort((a, b) => a.chainName.localeCompare(b.chainName));

  const dataset = DatasetIndex.parse({
    generatedAt: new Date().toISOString(),
    chains: entries,
  });
  await writeFile(join(DATA_DIR, "index.json"), JSON.stringify(dataset, null, 2));

  console.log(
    `\nDone. ${succeeded} succeeded, ${failures} failed this run. Index has ${entries.length} chains.`,
  );
  if (entries.length === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
