import { z } from "zod";

/**
 * A single field of a Msg/Query request or response message.
 * Mirrors the parts of a protobuf FieldDescriptor that matter to a consumer.
 */
export const FieldDef = z.object({
  name: z.string(),
  /** Proto type as a display string, e.g. "string", "uint64", "cosmos.base.v1beta1.Coin". */
  type: z.string(),
  /** Field number in the proto message. */
  number: z.number().int(),
  repeated: z.boolean(),
  optional: z.boolean(),
  /** Fully-qualified type name when the field references a message/enum (no leading dot). */
  typeRef: z.string().optional(),
  /** Leading doc comment, when harvested from source protos. */
  comment: z.string().optional(),
});
export type FieldDef = z.infer<typeof FieldDef>;

/** A transaction message (something a user signs and broadcasts). */
export const MsgDef = z.object({
  /** Amino/proto type URL, e.g. "/cosmos.bank.v1beta1.MsgSend". */
  typeUrl: z.string(),
  /** Short message name, e.g. "MsgSend". */
  name: z.string(),
  /** Proto package, e.g. "cosmos.bank.v1beta1". */
  package: z.string(),
  /** Best-effort module name, e.g. "bank". */
  module: z.string().optional(),
  /** Declared signer field names (from the cosmos.msg.v1.signer option), when present. */
  signers: z.array(z.string()).optional(),
  fields: z.array(FieldDef),
  comment: z.string().optional(),
});
export type MsgDef = z.infer<typeof MsgDef>;

/** A gRPC query method. */
export const QueryDef = z.object({
  /** Fully-qualified service name, e.g. "cosmos.bank.v1beta1.Query". */
  service: z.string(),
  /** Method name, e.g. "Balance". */
  method: z.string(),
  package: z.string(),
  module: z.string().optional(),
  /** Fully-qualified request message name (no leading dot). */
  requestType: z.string(),
  /** Fully-qualified response message name (no leading dot). */
  responseType: z.string(),
  requestFields: z.array(FieldDef),
  /** REST path from the google.api.http annotation, when present. */
  httpPath: z.string().optional(),
  comment: z.string().optional(),
});
export type QueryDef = z.infer<typeof QueryDef>;

/** Any proto message type (including ones only referenced as nested fields, e.g. CollectionApproval). */
export const TypeDef = z.object({
  /** Fully-qualified type name, e.g. "badges.CollectionApproval". */
  fullName: z.string(),
  /** Short name, e.g. "CollectionApproval". */
  name: z.string(),
  package: z.string(),
  module: z.string().optional(),
  fields: z.array(FieldDef),
  comment: z.string().optional(),
});
export type TypeDef = z.infer<typeof TypeDef>;

export const HarvestSource = z.enum(["reflection", "source"]);
export type HarvestSource = z.infer<typeof HarvestSource>;

/** Provenance of a single chain's catalog. */
export const HarvestProvenance = z.object({
  source: HarvestSource,
  harvestedAt: z.string(),
  /** gRPC endpoint used (reflection) or git ref used (source). */
  origin: z.string(),
  /** Whether comments were enriched from source protos. */
  commentsFromSource: z.boolean().default(false),
});
export type HarvestProvenance = z.infer<typeof HarvestProvenance>;

/** The full Msg/Query catalog for one chain. */
export const ChainCatalog = z.object({
  chainName: z.string(),
  prettyName: z.string().optional(),
  chainId: z.string().optional(),
  logoUrl: z.string().optional(),
  sdkVersion: z.string().optional(),
  provenance: HarvestProvenance,
  msgs: z.array(MsgDef),
  queries: z.array(QueryDef),
  types: z.array(TypeDef).default([]),
});
export type ChainCatalog = z.infer<typeof ChainCatalog>;

/** One chain's entry in the top-level dataset index. */
export const IndexEntry = z.object({
  chainName: z.string(),
  prettyName: z.string().optional(),
  chainId: z.string().optional(),
  /** Chain logo URL from the Cosmos Chain Registry (svg preferred). */
  logoUrl: z.string().optional(),
  msgCount: z.number().int(),
  queryCount: z.number().int(),
  typeCount: z.number().int().default(0),
  provenance: HarvestProvenance,
});
export type IndexEntry = z.infer<typeof IndexEntry>;

/** Top-level index over the whole dataset. */
export const DatasetIndex = z.object({
  generatedAt: z.string(),
  chains: z.array(IndexEntry),
});
export type DatasetIndex = z.infer<typeof DatasetIndex>;
