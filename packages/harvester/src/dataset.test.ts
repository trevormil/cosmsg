import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { DatasetIndex, MsgDef, QueryDef } from "@cosmsg/schema";

const DATA_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "data",
);
const indexPath = join(DATA_DIR, "index.json");
const maybe = existsSync(indexPath) ? describe : describe.skip;

maybe("committed dataset", () => {
  const index = DatasetIndex.parse(
    JSON.parse(readFileSync(indexPath, "utf8")),
  );

  it("has at least one chain", () => {
    expect(index.chains.length).toBeGreaterThan(0);
  });

  it("every chain's msgs.json and queries.json conform to the schema", () => {
    for (const entry of index.chains) {
      const msgs = JSON.parse(
        readFileSync(join(DATA_DIR, entry.chainName, "msgs.json"), "utf8"),
      );
      const queries = JSON.parse(
        readFileSync(join(DATA_DIR, entry.chainName, "queries.json"), "utf8"),
      );
      for (const m of msgs) MsgDef.parse(m);
      for (const q of queries) QueryDef.parse(q);
      expect(msgs.length).toBe(entry.msgCount);
      expect(queries.length).toBe(entry.queryCount);
    }
  });

  it("every typeUrl is unique within a chain and well-formed", () => {
    for (const entry of index.chains) {
      const msgs: { typeUrl: string }[] = JSON.parse(
        readFileSync(join(DATA_DIR, entry.chainName, "msgs.json"), "utf8"),
      );
      const seen = new Set<string>();
      for (const m of msgs) {
        expect(m.typeUrl).toMatch(/^\/[A-Za-z0-9_.]+$/);
        expect(seen.has(m.typeUrl)).toBe(false);
        seen.add(m.typeUrl);
      }
    }
  });
});
