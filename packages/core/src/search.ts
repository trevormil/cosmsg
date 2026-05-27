import type { ChainCatalog, MsgDef, QueryDef, TypeDef } from "@cosmsg/schema";

export type SearchKind = "msg" | "query" | "type";

/** A flattened, searchable record for one Msg or Query. */
export interface SearchRecord {
  chainName: string;
  kind: SearchKind;
  /** typeUrl for msgs, "service.method" for queries. */
  id: string;
  name: string;
  module?: string;
  /** Lower-cased haystack of everything worth matching. */
  haystack: string;
}

export interface SearchResult {
  record: SearchRecord;
  score: number;
}

/** Build flat search records from a map of chainName -> catalog. */
export function buildSearchRecords(
  catalogs: Record<string, ChainCatalog>,
): SearchRecord[] {
  const records: SearchRecord[] = [];
  for (const [chainName, cat] of Object.entries(catalogs)) {
    for (const m of cat.msgs) records.push(msgRecord(chainName, m));
    for (const q of cat.queries) records.push(queryRecord(chainName, q));
    for (const t of cat.types) records.push(typeRecord(chainName, t));
  }
  return records;
}

function typeRecord(chainName: string, t: TypeDef): SearchRecord {
  const parts = [
    t.fullName,
    t.name,
    t.module ?? "",
    t.comment ?? "",
    ...t.fields.map((f) => f.name),
  ];
  return {
    chainName,
    kind: "type",
    id: t.fullName,
    name: t.name,
    module: t.module,
    haystack: parts.join(" ").toLowerCase(),
  };
}

function msgRecord(chainName: string, m: MsgDef): SearchRecord {
  const parts = [
    m.typeUrl,
    m.name,
    m.module ?? "",
    m.package,
    m.comment ?? "",
    ...m.fields.map((f) => f.name),
  ];
  return {
    chainName,
    kind: "msg",
    id: m.typeUrl,
    name: m.name,
    module: m.module,
    haystack: parts.join(" ").toLowerCase(),
  };
}

function queryRecord(chainName: string, q: QueryDef): SearchRecord {
  const id = `${q.service}.${q.method}`;
  const parts = [
    id,
    q.method,
    q.module ?? "",
    q.package,
    q.comment ?? "",
    ...q.requestFields.map((f) => f.name),
  ];
  return {
    chainName,
    kind: "query",
    id,
    name: q.method,
    module: q.module,
    haystack: parts.join(" ").toLowerCase(),
  };
}

/**
 * Rank records against a free-text query. All whitespace-separated terms must match
 * (AND semantics). Scoring rewards matches on the id/name over deep field/comment matches.
 */
export function search(
  records: SearchRecord[],
  query: string,
  limit = 50,
): SearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const results: SearchResult[] = [];
  for (const record of records) {
    let score = 0;
    let matchedAll = true;
    for (const term of terms) {
      if (!record.haystack.includes(term)) {
        matchedAll = false;
        break;
      }
      if (record.name.toLowerCase().includes(term)) score += 10;
      else if (record.id.toLowerCase().includes(term)) score += 6;
      else score += 1;
    }
    if (matchedAll) results.push({ record, score });
  }

  results.sort(
    (a, b) =>
      b.score - a.score ||
      a.record.id.length - b.record.id.length ||
      a.record.id.localeCompare(b.record.id),
  );
  return results.slice(0, limit);
}
