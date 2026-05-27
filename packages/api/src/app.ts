import {
  buildSearchRecords,
  search,
  type Dataset,
} from "@cosmsg/core";
import { Hono } from "hono";

/**
 * Build the cosmsg read API over a pre-loaded dataset. Runtime-agnostic: the same app is
 * served by Bun locally (src/server.ts) and by Cloudflare Workers (src/worker.ts).
 */
export function createApp(dataset: Dataset) {
  const records = buildSearchRecords(dataset.catalogs);
  const app = new Hono();

  // permissive CORS so the static site / other tools can call it
  app.use("*", async (c, next) => {
    await next();
    c.header("Access-Control-Allow-Origin", "*");
  });

  app.get("/", (c) =>
    c.json({
      name: "cosmsg",
      description:
        "Every Msg and Query for every Cosmos chain. Built on the Cosmos Chain Registry.",
      generatedAt: dataset.index.generatedAt,
      chains: dataset.index.chains.length,
      routes: [
        "/chains",
        "/chains/:chain",
        "/chains/:chain/msgs",
        "/chains/:chain/queries",
        "/search?q=&limit=",
      ],
    }),
  );

  app.get("/chains", (c) => c.json(dataset.index.chains));

  app.get("/chains/:chain", (c) => {
    const cat = dataset.catalogs[c.req.param("chain")];
    if (!cat) return c.json({ error: "unknown chain" }, 404);
    return c.json({
      chainName: cat.chainName,
      prettyName: cat.prettyName,
      chainId: cat.chainId,
      provenance: cat.provenance,
      msgCount: cat.msgs.length,
      queryCount: cat.queries.length,
    });
  });

  app.get("/chains/:chain/msgs", (c) => {
    const cat = dataset.catalogs[c.req.param("chain")];
    if (!cat) return c.json({ error: "unknown chain" }, 404);
    const typeUrl = c.req.query("typeUrl");
    if (typeUrl) {
      const msg = cat.msgs.find((m) => m.typeUrl === typeUrl);
      return msg ? c.json(msg) : c.json({ error: "unknown msg" }, 404);
    }
    return c.json(cat.msgs);
  });

  app.get("/chains/:chain/queries", (c) => {
    const cat = dataset.catalogs[c.req.param("chain")];
    if (!cat) return c.json({ error: "unknown chain" }, 404);
    return c.json(cat.queries);
  });

  app.get("/search", (c) => {
    const q = c.req.query("q") ?? "";
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    const results = search(records, q, limit).map((r) => ({
      chain: r.record.chainName,
      kind: r.record.kind,
      id: r.record.id,
      name: r.record.name,
      module: r.record.module,
      score: r.score,
    }));
    return c.json({ query: q, count: results.length, results });
  });

  return app;
}
