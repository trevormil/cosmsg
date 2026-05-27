#!/usr/bin/env bun
/** Generate public/dataset.json (index + all catalogs) for the static site to fetch. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDatasetFromDir } from "@cosmsg/core";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR =
  process.env.COSMSG_DATA_DIR ?? join(HERE, "..", "..", "..", "data");
const OUT = join(HERE, "..", "public", "dataset.json");

const dataset = loadDatasetFromDir(DATA_DIR);
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(dataset));
console.log(`Wrote ${OUT} (${dataset.index.chains.length} chains).`);
