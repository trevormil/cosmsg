#!/usr/bin/env bun
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDatasetFromDir } from "@cosmsg/core";
import { createApp } from "./app.js";

const DATA_DIR =
  process.env.COSMSG_DATA_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data");

const dataset = loadDatasetFromDir(DATA_DIR);
const app = createApp(dataset);
const port = Number(process.env.PORT ?? 8787);

Bun.serve({ port, fetch: app.fetch });
console.log(
  `cosmsg API on http://localhost:${port} (${dataset.index.chains.length} chains)`,
);
