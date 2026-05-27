#!/usr/bin/env bun
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSearchRecords,
  loadDatasetFromDir,
  search,
} from "@cosmsg/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const DATA_DIR =
  process.env.COSMSG_DATA_DIR ??
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "data");

const dataset = loadDatasetFromDir(DATA_DIR);
const records = buildSearchRecords(dataset.catalogs);

const chainNames = Object.keys(dataset.catalogs).sort();

function requireChain(chain: string) {
  const cat = dataset.catalogs[chain];
  if (!cat) {
    throw new Error(
      `unknown chain "${chain}". Known chains: ${chainNames.join(", ")}`,
    );
  }
  return cat;
}

function text(value: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(value, null, 2) },
    ],
  };
}

const server = new McpServer({
  name: "cosmsg",
  version: "0.1.0",
});

server.tool(
  "list_chains",
  "List every Cosmos chain in the catalog with its Msg and Query counts.",
  {},
  async () => text(dataset.index.chains),
);

server.tool(
  "list_msgs",
  "List all transaction Msg type URLs for a chain.",
  { chain: z.string().describe("Chain registry name, e.g. 'osmosis'.") },
  async ({ chain }) => {
    const cat = requireChain(chain);
    return text(
      cat.msgs.map((m) => ({
        typeUrl: m.typeUrl,
        module: m.module,
        comment: m.comment,
      })),
    );
  },
);

server.tool(
  "get_msg",
  "Get the full field schema for a single Msg on a chain.",
  {
    chain: z.string().describe("Chain registry name, e.g. 'osmosis'."),
    typeUrl: z
      .string()
      .describe("Msg type URL, e.g. '/cosmos.bank.v1beta1.MsgSend'."),
  },
  async ({ chain, typeUrl }) => {
    const cat = requireChain(chain);
    const msg = cat.msgs.find((m) => m.typeUrl === typeUrl);
    if (!msg) throw new Error(`no Msg "${typeUrl}" on chain "${chain}"`);
    return text(msg);
  },
);

server.tool(
  "list_queries",
  "List all gRPC query methods for a chain.",
  { chain: z.string().describe("Chain registry name, e.g. 'osmosis'.") },
  async ({ chain }) => {
    const cat = requireChain(chain);
    return text(
      cat.queries.map((q) => ({
        service: q.service,
        method: q.method,
        httpPath: q.httpPath,
        comment: q.comment,
      })),
    );
  },
);

server.tool(
  "get_query",
  "Get the request schema and response type for a single query on a chain.",
  {
    chain: z.string().describe("Chain registry name."),
    service: z
      .string()
      .describe("Fully-qualified service, e.g. 'cosmos.bank.v1beta1.Query'."),
    method: z.string().describe("Method name, e.g. 'Balance'."),
  },
  async ({ chain, service, method }) => {
    const cat = requireChain(chain);
    const q = cat.queries.find(
      (x) => x.service === service && x.method === method,
    );
    if (!q) throw new Error(`no query ${service}.${method} on "${chain}"`);
    return text(q);
  },
);

server.tool(
  "search",
  "Search Msgs and queries across all chains by name, type URL, module, or field.",
  {
    query: z.string().describe("Free-text query, e.g. 'swap' or 'MsgSend'."),
    limit: z.number().int().positive().max(200).default(30),
  },
  async ({ query, limit }) =>
    text(
      search(records, query, limit).map((r) => ({
        chain: r.record.chainName,
        kind: r.record.kind,
        id: r.record.id,
        module: r.record.module,
      })),
    ),
);

await server.connect(new StdioServerTransport());
console.error(
  `cosmsg MCP server ready: ${chainNames.length} chains, ${records.length} records.`,
);
