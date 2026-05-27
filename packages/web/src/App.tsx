import type {
  ChainCatalog,
  DatasetIndex,
  FieldDef,
  IndexEntry,
  MsgDef,
  QueryDef,
  TypeDef,
} from "@cosmsg/schema";
import { buildSearchRecords, search, type SearchRecord } from "@cosmsg/core/search";
import {
  type CSSProperties,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import bitbadgesLogo from "./assets/bitbadges.png";

/** Lets any FieldTable resolve a referenced type so it can be expanded inline, recursively. */
const TypeLookup = createContext<{
  getType: (fullName: string) => TypeDef | undefined;
}>({ getType: () => undefined });

/** Max nesting depth for inline type drill-down (cyclic refs are also stopped via the path). */
const MAX_NEST_DEPTH = 12;

interface Dataset {
  index: DatasetIndex;
  catalogs: Record<string, ChainCatalog>;
}

type Tab = "msgs" | "queries" | "types";

function kindToTab(kind: SearchRecord["kind"]): Tab {
  return kind === "msg" ? "msgs" : kind === "query" ? "queries" : "types";
}

/** Local logo overrides that take precedence over the Chain Registry image. */
const LOGO_OVERRIDES: Record<string, string> = {
  bitbadges: bitbadgesLogo,
};

function ChainLogo({
  entry,
  size = 22,
}: {
  entry?: IndexEntry;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const label = entry?.prettyName ?? entry?.chainName ?? "?";
  const style = { width: size, height: size, fontSize: size * 0.5 };
  const src = (entry && LOGO_OVERRIDES[entry.chainName]) ?? entry?.logoUrl;
  if (src && !failed) {
    return (
      <img
        className="logo-img"
        style={style}
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="logo-fallback" style={style}>
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

export function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("msgs");
  const [query, setQuery] = useState("");
  const [showDocs, setShowDocs] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Press "/" anywhere to jump to search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const metaByChain = useMemo(() => {
    const m = new Map<string, IndexEntry>();
    for (const e of dataset?.index.chains ?? []) m.set(e.chainName, e);
    return m;
  }, [dataset]);

  const totals = useMemo(() => {
    let msgs = 0;
    let queries = 0;
    for (const e of dataset?.index.chains ?? []) {
      msgs += e.msgCount;
      queries += e.queryCount;
    }
    return { msgs, queries };
  }, [dataset]);

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
          <span className="brand-mark" />
          <span className="logo">
            cos<b>msg</b>
          </span>
          <span className="tagline">multi-chain proto explorer</span>
        </div>
        <div className="searchwrap">
          <input
            ref={searchRef}
            className="search"
            type="search"
            placeholder="Search Msgs, queries & types across every chain…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShowDocs(false);
            }}
            autoFocus
          />
          <span className="kbd">/</span>
        </div>
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
            <span>{dataset.index.chains.length} chains</span>
            <span className="sidebar-totals">
              {totals.msgs.toLocaleString()} msgs ·{" "}
              {totals.queries.toLocaleString()} queries
            </span>
          </div>
          {dataset.index.chains.map((c, i) => (
            <button
              key={c.chainName}
              style={{ "--i": i } as CSSProperties}
              className={`chain-btn ${c.chainName === chain && !query && !showDocs ? "active" : ""}`}
              onClick={() => {
                setChain(c.chainName);
                setQuery("");
                setShowDocs(false);
              }}
            >
              <ChainLogo entry={c} />
              <span className="chain-text">
                <span className="chain-name">{c.prettyName ?? c.chainName}</span>
                <span className="chain-counts">
                  {c.msgCount} msgs · {c.queryCount} queries
                </span>
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
              metaByChain={metaByChain}
              onPick={(r) => {
                setChain(r.chainName);
                setTab(kindToTab(r.kind));
                setQuery("");
              }}
            />
          ) : catalog ? (
            <ChainView
              catalog={catalog}
              entry={metaByChain.get(catalog.chainName)}
              tab={tab}
              setTab={setTab}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="codeblock">
      <div className="code-bar">
        {lang && <span className="code-lang">{lang}</span>}
        <button
          className="code-copy"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setDone(true);
            setTimeout(() => setDone(false), 1000);
          }}
        >
          {done ? "copied" : "copy"}
        </button>
      </div>
      <pre>{code}</pre>
    </div>
  );
}

function DocsView({ dataset }: { dataset: Dataset }) {
  const example = dataset.index.chains[0]?.chainName ?? "osmosis";
  return (
    <div className="docs">
      <h1>Integrate cosmsg</h1>
      <p className="lede">
        A single, machine-readable catalog of every transaction <code>Msg</code>{" "}
        and gRPC query for every Cosmos chain — consume it three ways: the raw
        JSON dataset, the HTTP API, or the MCP server. All three read the same
        data, harvested from each chain's protobuf schema and layered on the{" "}
        <a href="https://github.com/cosmos/chain-registry">
          Cosmos Chain Registry
        </a>
        .
      </p>

      <h2>1 · HTTP API</h2>
      <p>
        A thin read API (Hono — runs on Bun locally, deploys to Cloudflare
        Workers). Run it with <code>bun run api</code> (defaults to{" "}
        <code>http://localhost:8787</code>).
      </p>
      <CodeBlock
        lang="endpoints"
        code={`GET /chains                      list every chain + counts
GET /chains/${example}              one chain summary + provenance
GET /chains/${example}/msgs         all Msgs   (?typeUrl=/x.y.MsgZ for one)
GET /chains/${example}/queries      all queries
GET /search?q=swap&limit=20      rank Msgs/queries across all chains`}
      />
      <CodeBlock
        lang="curl"
        code={`curl "http://localhost:8787/chains/${example}/msgs?typeUrl=/cosmos.bank.v1beta1.MsgSend"`}
      />
      <CodeBlock
        lang="response"
        code={`{
  "typeUrl": "/cosmos.bank.v1beta1.MsgSend",
  "module": "bank",
  "signers": ["from_address"],
  "fields": [
    { "name": "from_address", "type": "string",  "number": 1 },
    { "name": "to_address",   "type": "string",  "number": 2 },
    { "name": "amount", "type": "cosmos.base.v1beta1.Coin",
      "number": 3, "repeated": true }
  ]
}`}
      />

      <h2>2 · MCP server</h2>
      <p>
        Point any MCP client (Claude Code, Cursor, …) at the server so agents can
        look up message schemas on demand. Add it to your MCP config:
      </p>
      <CodeBlock
        lang="mcp.json"
        code={`{
  "mcpServers": {
    "cosmsg": { "command": "bun", "args": ["run", "packages/mcp/src/index.ts"] }
  }
}`}
      />
      <p>
        Tools: <code>list_chains</code>, <code>list_msgs</code>,{" "}
        <code>get_msg</code>, <code>list_queries</code>, <code>get_query</code>,{" "}
        <code>search</code>. For example, an agent can call{" "}
        <code>search</code> to find a message across chains:
      </p>
      <CodeBlock
        lang="tool call"
        code={`get_msg(chain: "${example}", typeUrl: "/cosmos.staking.v1beta1.MsgDelegate")
search(query: "swap", limit: 10)`}
      />

      <h2>3 · Raw dataset</h2>
      <p>
        Every catalog is plain JSON, committed under <code>data/</code> and
        bundled into this site at <code>/dataset.json</code>:
      </p>
      <CodeBlock
        lang="files"
        code={`data/index.json                all chains + counts + provenance
data/<chain>/msgs.json         array of MsgDef
data/<chain>/queries.json      array of QueryDef`}
      />

      <h2>Data shape</h2>
      <CodeBlock
        lang="types"
        code={`MsgDef   { typeUrl, name, package, module?, signers?, fields[], comment? }
QueryDef { service, method, requestType, responseType,
           requestFields[], httpPath?, comment? }
FieldDef { name, type, number, repeated, optional, typeRef?, comment? }`}
      />
      <p className="muted">
        Each chain records its <code>provenance</code> — whether it was harvested
        via live gRPC <code>reflection</code> or built from <code>source</code>{" "}
        protos (the source path also recovers doc comments).
      </p>

      <h2>Add a chain</h2>
      <p>
        Append it to <code>packages/harvester/src/allowlist.ts</code> (the{" "}
        <code>chainName</code> must match its Chain Registry directory), then run{" "}
        <code>bun run harvest &lt;chain&gt;</code>. A weekly GitHub Action
        re-harvests everything and commits the refreshed dataset.
      </p>
    </div>
  );
}

function SearchView({
  results,
  metaByChain,
  onPick,
}: {
  results: { record: SearchRecord }[];
  metaByChain: Map<string, IndexEntry>;
  onPick: (r: SearchRecord) => void;
}) {
  if (results.length === 0)
    return <div className="status">No matches.</div>;
  return (
    <div className="search-results">
      <div className="results-head">{results.length} results</div>
      {results.map(({ record }) => {
        const entry = metaByChain.get(record.chainName);
        return (
          <button
            key={`${record.chainName}:${record.kind}:${record.id}`}
            className="result-row"
            onClick={() => onPick(record)}
          >
            <span className={`badge ${record.kind}`}>{record.kind}</span>
            <span className="result-id">{record.id}</span>
            <span className="result-chain">
              <ChainLogo entry={entry} size={16} />
              {entry?.prettyName ?? record.chainName}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Standard Cosmos / infra namespaces — sorted after chain-native ones. */
const STANDARD_NS = new Set([
  "cosmos",
  "ibc",
  "cosmwasm",
  "ics23",
  "capability",
  "tendermint",
  "google",
  "gogoproto",
  "amino",
  "cosmos_proto",
  "interchain_security",
  "feemarket",
  "ethermint",
]);

/** Top-level namespace of a proto package, e.g. "cosmos.bank.v1beta1" -> "cosmos". */
function namespaceOf(pkg: string): string {
  return pkg.split(".")[0] || pkg;
}

/** Chain-native namespaces first, then standard infra; alphabetical within each. */
function sortNamespaces(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const sa = STANDARD_NS.has(a) ? 1 : 0;
    const sb = STANDARD_NS.has(b) ? 1 : 0;
    return sa - sb || a.localeCompare(b);
  });
}

interface Group<T> {
  ns: string;
  items: T[];
}

function groupByNamespace<T>(items: T[], pkgOf: (t: T) => string): Group<T>[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const ns = namespaceOf(pkgOf(it));
    const bucket = map.get(ns);
    if (bucket) bucket.push(it);
    else map.set(ns, [it]);
  }
  return sortNamespaces([...map.keys()]).map((ns) => ({
    ns,
    items: map.get(ns)!,
  }));
}

function ChainView({
  catalog,
  entry,
  tab,
  setTab,
}: {
  catalog: ChainCatalog;
  entry?: IndexEntry;
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const f = filter.toLowerCase();
  const typeMap = useMemo(
    () => new Map(catalog.types.map((t) => [t.fullName, t] as const)),
    [catalog],
  );

  const groups = useMemo(() => {
    if (tab === "msgs")
      return groupByNamespace(
        catalog.msgs.filter((m) => !f || m.typeUrl.toLowerCase().includes(f)),
        (m) => m.package,
      );
    if (tab === "queries")
      return groupByNamespace(
        catalog.queries.filter(
          (q) => !f || `${q.service}.${q.method}`.toLowerCase().includes(f),
        ),
        (q) => q.package,
      );
    return groupByNamespace(
      catalog.types.filter((t) => !f || t.fullName.toLowerCase().includes(f)),
      (t) => t.package,
    );
  }, [tab, f, catalog]);

  // Clear filter when the chain changes.
  useEffect(() => {
    setFilter("");
  }, [catalog.chainName]);

  // Start collapsed on every chain/tab change — show namespace headers only.
  useEffect(() => {
    setExpanded(new Set());
  }, [catalog.chainName, tab]);

  const toggle = (ns: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(ns) ? next.delete(ns) : next.add(ns);
      return next;
    });
  const isOpen = (ns: string) => (f ? true : expanded.has(ns));

  const tabs: Tab[] = ["msgs", "queries", "types"];
  const counts = {
    msgs: catalog.msgs.length,
    queries: catalog.queries.length,
    types: catalog.types.length,
  };

  return (
    <TypeLookup.Provider value={{ getType: (n) => typeMap.get(n) }}>
      <div className="chain-header">
        <ChainLogo entry={entry} size={40} />
        <div>
          <h1>{catalog.prettyName ?? catalog.chainName}</h1>
          <div className="chain-meta">
            {catalog.chainId && <span>{catalog.chainId}</span>}
            <span className="prov">
              via {catalog.provenance.source}
              {catalog.provenance.commentsFromSource ? " · with docs" : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t === "msgs" ? "Msgs" : t === "queries" ? "Queries" : "Types"}{" "}
            <span className="count">{counts[t]}</span>
          </button>
        ))}
        <input
          className="filter"
          type="search"
          placeholder={`Filter ${tab}…`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="groups">
        {groups.map((g) => (
          <section key={g.ns} className={`ns-group ${isOpen(g.ns) ? "open" : ""}`}>
            <button className="ns-head" onClick={() => toggle(g.ns)}>
              <span className="ns-chevron">{isOpen(g.ns) ? "▾" : "▸"}</span>
              <span className="ns-name">{g.ns}</span>
              {STANDARD_NS.has(g.ns) && <span className="ns-tag">standard</span>}
              <span className="ns-count">{g.items.length}</span>
            </button>
            {isOpen(g.ns) && (
              <div className="ns-body">
                {tab === "msgs" &&
                  (g.items as MsgDef[]).map((m) => (
                    <MsgRow key={m.typeUrl} msg={m} />
                  ))}
                {tab === "queries" &&
                  (g.items as QueryDef[]).map((q) => (
                    <QueryRow key={`${q.service}.${q.method}`} query={q} />
                  ))}
                {tab === "types" &&
                  (g.items as TypeDef[]).map((t) => (
                    <TypeRow key={t.fullName} type={t} />
                  ))}
              </div>
            )}
          </section>
        ))}
        {groups.length === 0 && <div className="status">No matches.</div>}
      </div>
    </TypeLookup.Provider>
  );
}

function MsgRow({ msg }: { msg: MsgDef }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`row row-msg ${open ? "open" : ""}`}>
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
    <div className={`row row-query ${open ? "open" : ""}`}>
      <button className="row-head" onClick={() => setOpen(!open)}>
        <code className="id">
          {query.service}.<b>{query.method}</b>
        </code>
        {query.httpPath && <span className="http">{query.httpPath}</span>}
      </button>
      {open && (
        <div className="row-body">
          {query.comment && <p className="doc">{query.comment}</p>}
          <div className="response">
            → <ExpandableType name={query.responseType} />
          </div>
          <FieldTable fields={query.requestFields} />
        </div>
      )}
    </div>
  );
}

function TypeRow({ type }: { type: TypeDef }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`row row-type ${open ? "open" : ""}`}>
      <button className="row-head" onClick={() => setOpen(!open)}>
        <code className="id">{type.fullName}</code>
        {type.module && <span className="module">{type.module}</span>}
        <CopyButton text={type.fullName} />
      </button>
      {open && (
        <div className="row-body">
          {type.comment && <p className="doc">{type.comment}</p>}
          <FieldTable fields={type.fields} path={[type.fullName]} />
        </div>
      )}
    </div>
  );
}

/** A standalone type reference (e.g. a query response) that expands its fields inline. */
function ExpandableType({ name }: { name: string }) {
  const { getType } = useContext(TypeLookup);
  const [open, setOpen] = useState(false);
  const target = getType(name);
  if (!target) return <span className="type-plain">{name}</span>;
  return (
    <>
      <button className="type-expand" onClick={() => setOpen(!open)}>
        <span className="ns-chevron">{open ? "▾" : "▸"}</span>
        {name}
      </button>
      {open && (
        <div className="nested">
          {target.comment && <p className="doc">{target.comment}</p>}
          <FieldTable fields={target.fields} path={[name]} />
        </div>
      )}
    </>
  );
}

function FieldTable({
  fields,
  path = [],
}: {
  fields: FieldDef[];
  path?: string[];
}) {
  if (fields.length === 0) return <p className="empty">no fields</p>;
  return (
    <table className="fields">
      <tbody>
        {fields.map((f) => (
          <FieldRow key={f.number} field={f} path={path} />
        ))}
      </tbody>
    </table>
  );
}

/** One field row; if its type resolves to a known message, it can be expanded inline. */
function FieldRow({ field, path }: { field: FieldDef; path: string[] }) {
  const { getType } = useContext(TypeLookup);
  const [open, setOpen] = useState(false);
  const ref = field.typeRef;
  const target = ref ? getType(ref) : undefined;
  const cyclic = ref ? path.includes(ref) : false;
  const expandable = !!target && !cyclic && path.length < MAX_NEST_DEPTH;
  return (
    <>
      <tr>
        <td className="fnum">{field.number}</td>
        <td className="fname">{field.name}</td>
        <td className="ftype">
          {field.repeated && <span className="rep">repeated </span>}
          {expandable ? (
            <button className="type-expand" onClick={() => setOpen(!open)}>
              <span className="ns-chevron">{open ? "▾" : "▸"}</span>
              {field.type}
            </button>
          ) : cyclic ? (
            <span className="type-cyclic" title="recursive reference">
              {field.type} ↻
            </span>
          ) : (
            field.type
          )}
          {field.optional && <span className="opt"> ?</span>}
        </td>
        <td className="fcomment">{field.comment}</td>
      </tr>
      {open && target && (
        <tr className="nested-row">
          <td />
          <td colSpan={3}>
            <div className="nested">
              {target.comment && <p className="doc">{target.comment}</p>}
              <FieldTable fields={target.fields} path={[...path, ref!]} />
            </div>
          </td>
        </tr>
      )}
    </>
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
