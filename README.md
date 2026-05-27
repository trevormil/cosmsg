# cosmsg

**One place to see every transaction `Msg` and gRPC query for every Cosmos chain.**

The [Cosmos Chain Registry](https://github.com/cosmos/chain-registry) is great, but it only carries chain *metadata* — not the actual `Msg` and query surface each chain supports. To learn that today, you have to dig through each chain's individual docs or read its protobuf source.

`cosmsg` fills that gap. It harvests the full proto schema of each chain (via gRPC reflection, with a build-from-source fallback) and publishes a normalized catalog of every Msg and query, with field-level schemas and doc comments — browsable on the web, queryable over an API, and available to AI agents over MCP.

We **do not** reinvent the chain registry — we consume it as the source of truth for the chain list, gRPC endpoints, and source repos.

## What you get

- **Dataset** — plain JSON in `data/`, the shared core everything else reads.
- **Website** (`packages/web`) — browse chains, expand field schemas, search across all chains. Built-in developer docs.
- **HTTP API** (`packages/api`) — Hono app, deployable to Cloudflare Workers.
- **MCP server** (`packages/mcp`) — so agents can look up message schemas on demand.

## Quick start

```sh
bun install
bun run harvest            # harvest the curated allowlist into data/
bun run web                # browse at http://localhost:5173
bun run api                # API at http://localhost:8787
bun run mcp                # MCP server over stdio
bun test
bun run typecheck
```

Harvest a subset or force a source:

```sh
bun run harvest osmosis cosmoshub
bun run harvest --prefer source neutron
```

## Layout

```
packages/
  schema/      shared zod types for the dataset (MsgDef, QueryDef, FieldDef, ...)
  core/        dataset loader (node) + pure search (browser/worker safe)
  harvester/   CLI: chain-registry + reflection/source -> normalized JSON
  api/         Hono read API (Bun locally, Cloudflare Worker for deploy)
  mcp/         MCP server exposing the dataset as tools
  web/         Vite + React browse/search site with built-in docs
data/          generated catalog (committed, CI-refreshed weekly)
```

## How harvesting works

For each chain in the allowlist (`packages/harvester/src/allowlist.ts`):

1. Resolve it from the chain registry — gRPC endpoints (`apis.grpc[]`) + source repo (`codebase.git_repo`) + chain id.
2. **Live gRPC reflection** — pull the full `FileDescriptorSet` from a public endpoint via `cosmos.reflection.v1.ReflectionService` (one call), falling back to standard `grpc.reflection.v1alpha` server reflection.
3. **Source fallback** — if reflection is unavailable/broken (dead endpoints, HTTP/1.1 servers that crash gRPC, malformed descriptors), shallow-clone the source repo (or pull a Buf Schema Registry module) and `buf build` the protos. This path also recovers doc comments.
4. Parse the descriptors: Msgs are detected via the `cosmos.msg.v1` service/signer options, everything else service-side is a query. Fields are extracted with type, repeated/optional, message refs, and comments.
5. Write `data/<chain>/{msgs,queries}.json` + `data/index.json` with provenance.

Each chain is harvested in an **isolated worker process** with a per-chain timeout, so one flaky endpoint can't sink the run. On failure the orchestrator retries once with the other source (the hybrid).

## Data shape

```ts
MsgDef   { typeUrl, name, package, module?, signers?, fields[], comment? }
QueryDef { service, method, requestType, responseType, requestFields[], httpPath?, comment? }
FieldDef { name, type, number, repeated, optional, typeRef?, comment? }
```

`provenance` on each chain records whether it came from `reflection` or `source`.

## HTTP API

```
GET /chains                      list every chain + counts
GET /chains/:chain               one chain summary + provenance
GET /chains/:chain/msgs          all Msgs (?typeUrl=/x.y.MsgZ for one)
GET /chains/:chain/queries       all queries
GET /search?q=swap&limit=20      rank Msgs/queries across all chains
```

Deploy to Cloudflare Workers: `bun run --cwd packages/api deploy` (bundles the dataset, then `wrangler deploy`).

## MCP

```json
{
  "mcpServers": {
    "cosmsg": { "command": "bun", "args": ["run", "packages/mcp/src/index.ts"] }
  }
}
```

Tools: `list_chains`, `list_msgs`, `get_msg`, `list_queries`, `get_query`, `search`.

## Adding a chain

Append it to `ALLOWLIST` in `packages/harvester/src/allowlist.ts` (the `chainName` must match its Chain Registry directory name; optionally set `bufModule` for a known Buf Schema Registry module), then run `bun run harvest <chain>`. CI re-harvests the full allowlist weekly and commits the refreshed `data/`.

## License

MIT — see [LICENSE](./LICENSE).
