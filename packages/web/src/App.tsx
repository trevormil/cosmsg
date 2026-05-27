import type {
  ChainCatalog,
  DatasetIndex,
  FieldDef,
  MsgDef,
  QueryDef,
} from "@cosmsg/schema";
import { buildSearchRecords, search, type SearchRecord } from "@cosmsg/core/search";
import { useEffect, useMemo, useState } from "react";

interface Dataset {
  index: DatasetIndex;
  catalogs: Record<string, ChainCatalog>;
}

export function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<string | null>(null);
  const [tab, setTab] = useState<"msgs" | "queries">("msgs");
  const [query, setQuery] = useState("");
  const [showDocs, setShowDocs] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}dataset.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`failed to load dataset (${r.status})`);
        return r.json();
      })
      .then((d: Dataset) => {
        setDataset(d);
        setChain(d.index.chains[0]?.chainName ?? null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const records = useMemo(
    () => (dataset ? buildSearchRecords(dataset.catalogs) : []),
    [dataset],
  );
  const results = useMemo(
    () => (query.trim() ? search(records, query, 100) : []),
    [records, query],
  );

  if (error) return <div className="status error">{error}</div>;
  if (!dataset) return <div className="status">Loading catalog…</div>;

  const catalog = chain ? dataset.catalogs[chain] : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div
          className="brand"
          role="button"
          onClick={() => {
            setShowDocs(false);
            setQuery("");
          }}
        >
          <span className="logo">cosmsg</span>
          <span className="tagline">
            every Msg &amp; query for every Cosmos chain
          </span>
        </div>
        <input
          className="search"
          type="search"
          placeholder="Search all chains:  swap · MsgSend · staking…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDocs(false);
          }}
          autoFocus
        />
        <button
          className={`docs-link ${showDocs ? "active" : ""}`}
          onClick={() => setShowDocs(true)}
        >
          Docs
        </button>
      </header>

      <div className="body">
        <aside className="sidebar">
          <div className="sidebar-head">
            {dataset.index.chains.length} chains
          </div>
          {dataset.index.chains.map((c) => (
            <button
              key={c.chainName}
              className={`chain-btn ${c.chainName === chain && !query ? "active" : ""}`}
              onClick={() => {
                setChain(c.chainName);
                setQuery("");
              }}
            >
              <span className="chain-name">{c.prettyName ?? c.chainName}</span>
              <span className="chain-counts">
                {c.msgCount}m · {c.queryCount}q
              </span>
            </button>
          ))}
        </aside>

        <main className="main">
          {showDocs ? (
            <DocsView dataset={dataset} />
          ) : query.trim() ? (
            <SearchView
              results={results}
              onPick={(r) => {
                setChain(r.chainName);
                setTab(r.kind === "msg" ? "msgs" : "queries");
                setQuery("");
              }}
            />
          ) : catalog ? (
            <ChainView catalog={catalog} tab={tab} setTab={setTab} />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function DocsView({ dataset }: { dataset: Dataset }) {
  const example = dataset.index.chains[0]?.chainName ?? "osmosis";
  return (
    <div className="docs">
      <h1>cosmsg developer docs</h1>
      <p className="lede">
        A single, machine-readable catalog of every transaction <code>Msg</code>{" "}
        and gRPC query for every Cosmos chain. The data is harvested from each
        chain's protobuf schema (via gRPC reflection, with a build-from-source
        fallback) and layered on top of the{" "}
        <a href="https://github.com/cosmos/chain-registry">
          Cosmos Chain Registry
        </a>
        — which stays the source of truth for the chain list, endpoints, and
        source repos.
      </p>

      <h2>Consume the dataset directly</h2>
      <p>
        Every catalog is plain JSON, committed in the repo under{" "}
        <code>data/</code> and bundled into this site at{" "}
        <code>/dataset.json</code>:
      </p>
      <pre>
{`data/index.json                 # all chains + counts + provenance
data/<chain>/msgs.json          # array of MsgDef
data/<chain>/queries.json       # array of QueryDef`}
      </pre>

      <h2>HTTP API</h2>
      <p>
        A thin read API (Hono, deployable to Cloudflare Workers) serves the same
        data:
      </p>
      <pre>
{`GET /chains                       # list every chain + counts
GET /chains/${example}               # one chain's summary + provenance
GET /chains/${example}/msgs          # all Msgs   (?typeUrl=/x.y.MsgZ for one)
GET /chains/${example}/queries       # all queries
GET /search?q=swap&limit=20       # rank Msgs/queries across all chains`}
      </pre>

      <h2>MCP server</h2>
      <p>
        Point any MCP client (Claude Code, etc.) at the bundled server so agents
        can look up message schemas on demand. Tools:{" "}
        <code>list_chains</code>, <code>list_msgs</code>, <code>get_msg</code>,{" "}
        <code>list_queries</code>, <code>get_query</code>,{" "}
        <code>search</code>.
      </p>
      <pre>
{`{
  "mcpServers": {
    "cosmsg": { "command": "bun", "args": ["run", "packages/mcp/src/index.ts"] }
  }
}`}
      </pre>

      <h2>Data shape</h2>
      <pre>
{`MsgDef   { typeUrl, name, package, module?, signers?, fields[], comment? }
QueryDef { service, method, requestType, responseType,
           requestFields[], httpPath?, comment? }
FieldDef { name, type, number, repeated, optional, typeRef?, comment? }`}
      </pre>
      <p className="muted">
        Each chain records its <code>provenance</code> — whether it was harvested
        via live gRPC <code>reflection</code> or built from <code>source</code>{" "}
        protos (the source path also recovers doc comments).
      </p>

      <h2>Add a chain</h2>
      <p>
        Append it to the allowlist in{" "}
        <code>packages/harvester/src/allowlist.ts</code> (the{" "}
        <code>chainName</code> must match its Chain Registry directory), then run{" "}
        <code>bun run harvest &lt;chain&gt;</code>. A weekly GitHub Action
        re-harvests everything and commits the refreshed dataset.
      </p>
    </div>
  );
}

function SearchView({
  results,
  onPick,
}: {
  results: { record: SearchRecord }[];
  onPick: (r: SearchRecord) => void;
}) {
  if (results.length === 0)
    return <div className="status">No matches.</div>;
  return (
    <div className="search-results">
      <div className="results-head">{results.length} results</div>
      {results.map(({ record }) => (
        <button
          key={`${record.chainName}:${record.kind}:${record.id}`}
          className="result-row"
          onClick={() => onPick(record)}
        >
          <span className={`badge ${record.kind}`}>{record.kind}</span>
          <span className="result-id">{record.id}</span>
          <span className="result-chain">{record.chainName}</span>
        </button>
      ))}
    </div>
  );
}

function ChainView({
  catalog,
  tab,
  setTab,
}: {
  catalog: ChainCatalog;
  tab: "msgs" | "queries";
  setTab: (t: "msgs" | "queries") => void;
}) {
  const [filter, setFilter] = useState("");
  useEffect(() => setFilter(""), [catalog.chainName]);

  const f = filter.toLowerCase();
  const msgs = catalog.msgs.filter(
    (m) => !f || m.typeUrl.toLowerCase().includes(f),
  );
  const queries = catalog.queries.filter(
    (q) => !f || `${q.service}.${q.method}`.toLowerCase().includes(f),
  );

  return (
    <>
      <div className="chain-header">
        <h1>{catalog.prettyName ?? catalog.chainName}</h1>
        <div className="chain-meta">
          {catalog.chainId && <span>{catalog.chainId}</span>}
          <span className="prov">
            via {catalog.provenance.source}
            {catalog.provenance.commentsFromSource ? " · with docs" : ""}
          </span>
        </div>
      </div>

      <div className="tabs">
        <button
          className={tab === "msgs" ? "active" : ""}
          onClick={() => setTab("msgs")}
        >
          Msgs <span className="count">{catalog.msgs.length}</span>
        </button>
        <button
          className={tab === "queries" ? "active" : ""}
          onClick={() => setTab("queries")}
        >
          Queries <span className="count">{catalog.queries.length}</span>
        </button>
        <input
          className="filter"
          type="search"
          placeholder={`Filter ${tab}…`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="list">
        {tab === "msgs"
          ? msgs.map((m) => <MsgRow key={m.typeUrl} msg={m} />)
          : queries.map((q) => (
              <QueryRow key={`${q.service}.${q.method}`} query={q} />
            ))}
      </div>
    </>
  );
}

function MsgRow({ msg }: { msg: MsgDef }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`row ${open ? "open" : ""}`}>
      <button className="row-head" onClick={() => setOpen(!open)}>
        <code className="id">{msg.typeUrl}</code>
        {msg.module && <span className="module">{msg.module}</span>}
        <CopyButton text={msg.typeUrl} />
      </button>
      {open && (
        <div className="row-body">
          {msg.comment && <p className="doc">{msg.comment}</p>}
          {msg.signers && (
            <p className="signers">signers: {msg.signers.join(", ")}</p>
          )}
          <FieldTable fields={msg.fields} />
        </div>
      )}
    </div>
  );
}

function QueryRow({ query }: { query: QueryDef }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`row ${open ? "open" : ""}`}>
      <button className="row-head" onClick={() => setOpen(!open)}>
        <code className="id">
          {query.service}.<b>{query.method}</b>
        </code>
        {query.httpPath && <span className="http">{query.httpPath}</span>}
      </button>
      {open && (
        <div className="row-body">
          {query.comment && <p className="doc">{query.comment}</p>}
          <p className="response">→ {query.responseType}</p>
          <FieldTable fields={query.requestFields} />
        </div>
      )}
    </div>
  );
}

function FieldTable({ fields }: { fields: FieldDef[] }) {
  if (fields.length === 0) return <p className="empty">no fields</p>;
  return (
    <table className="fields">
      <tbody>
        {fields.map((f) => (
          <tr key={f.number}>
            <td className="fnum">{f.number}</td>
            <td className="fname">{f.name}</td>
            <td className="ftype">
              {f.repeated && <span className="rep">repeated </span>}
              {f.type}
              {f.optional && <span className="opt"> ?</span>}
            </td>
            <td className="fcomment">{f.comment}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <span
      className="copy"
      role="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1000);
      }}
    >
      {done ? "copied" : "copy"}
    </span>
  );
}
