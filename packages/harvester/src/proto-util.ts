import type {
  FieldDescriptorProto,
  FileDescriptorProto,
} from "@bufbuild/protobuf/wkt";
import { FieldDescriptorProto_Label } from "@bufbuild/protobuf/wkt";

/** Extension field numbers used by the Cosmos SDK to mark Msgs. */
export const COSMOS_MSG_SERVICE_OPTION = 11110000; // cosmos.msg.v1.service (bool) on ServiceOptions
export const COSMOS_MSG_SIGNER_OPTION = 11110000; // cosmos.msg.v1.signer (repeated string) on MessageOptions

/** Field number of the google.api.http option on MethodOptions. */
const GOOGLE_API_HTTP_OPTION = 72295728;

/** An unknown (unrecognized extension) field as preserved by @bufbuild/protobuf. */
interface UnknownField {
  no: number;
  wireType: number;
  data: Uint8Array;
}

function unknownFields(options: unknown): UnknownField[] {
  if (!options || typeof options !== "object") return [];
  const u = (options as { $unknown?: UnknownField[] }).$unknown;
  return Array.isArray(u) ? u : [];
}

/** True if a service carries the cosmos.msg.v1.service option (i.e. it is a Msg service). */
export function hasMsgServiceOption(options: unknown): boolean {
  return unknownFields(options).some((u) => u.no === COSMOS_MSG_SERVICE_OPTION);
}

/**
 * Read a length-delimited unknown field's payload as a UTF-8 string.
 * @bufbuild stores wire-type-2 data as [varint length][content].
 */
function readLenString(data: Uint8Array): string {
  let shift = 0;
  let len = 0;
  let i = 0;
  for (; i < data.length; i++) {
    const b = data[i]!;
    len |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      i++;
      break;
    }
    shift += 7;
  }
  return Buffer.from(data.slice(i, i + len)).toString("utf8");
}

/** Extract declared signer field names from a message's cosmos.msg.v1.signer option. */
export function readSigners(messageOptions: unknown): string[] {
  return unknownFields(messageOptions)
    .filter((u) => u.no === COSMOS_MSG_SIGNER_OPTION && u.wireType === 2)
    .map((u) => readLenString(u.data))
    .filter(Boolean);
}

/** Extract a REST path from a method's google.api.http option, if present. */
export function readHttpPath(methodOptions: unknown): string | undefined {
  const f = unknownFields(methodOptions).find(
    (u) => u.no === GOOGLE_API_HTTP_OPTION && u.wireType === 2,
  );
  if (!f) return undefined;
  // The HttpRule message nests get/post/... (fields 2-5) as length-delimited strings.
  // Recover the first string payload we can find as a best-effort path.
  const inner = f.data;
  // Skip the rule's own length prefix, then scan sub-fields for a string value.
  const path = scanFirstString(inner);
  return path || undefined;
}

function scanFirstString(data: Uint8Array): string {
  let i = 0;
  // optional outer length prefix
  while (i < data.length) {
    const tag = data[i]!;
    const wireType = tag & 0x07;
    i++;
    if (wireType === 2) {
      let shift = 0;
      let len = 0;
      for (; i < data.length; i++) {
        const b = data[i]!;
        len |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) {
          i++;
          break;
        }
        shift += 7;
      }
      const s = Buffer.from(data.slice(i, i + len)).toString("utf8");
      if (/^\//.test(s)) return s;
      i += len;
    } else if (wireType === 0) {
      while (i < data.length && (data[i]! & 0x80) !== 0) i++;
      i++;
    } else {
      break;
    }
  }
  return "";
}

const FIELD_TYPE_NAMES: Record<number, string> = {
  1: "double",
  2: "float",
  3: "int64",
  4: "uint64",
  5: "int32",
  6: "fixed64",
  7: "fixed32",
  8: "bool",
  9: "string",
  10: "group",
  11: "message",
  12: "bytes",
  13: "uint32",
  14: "enum",
  15: "sfixed32",
  16: "sfixed64",
  17: "sint32",
  18: "sint64",
};

/** Human-readable proto type for a field (e.g. "string", "uint64", "cosmos.base.v1beta1.Coin"). */
export function fieldTypeName(field: FieldDescriptorProto): string {
  if (field.typeName) return field.typeName.replace(/^\./, "");
  return FIELD_TYPE_NAMES[field.type] ?? `type${field.type}`;
}

export function isRepeated(field: FieldDescriptorProto): boolean {
  return field.label === FieldDescriptorProto_Label.REPEATED;
}

export function isOptional(field: FieldDescriptorProto): boolean {
  return field.proto3Optional === true;
}

/** Strip a leading dot from a fully-qualified proto type name. */
export function stripLeadingDot(name: string): string {
  return name.replace(/^\./, "");
}

/** Derive a best-effort module name from a proto package (e.g. cosmos.bank.v1beta1 -> bank). */
export function moduleFromPackage(pkg: string): string | undefined {
  if (!pkg) return undefined;
  const parts = pkg.split(".");
  const versionIdx = parts.findIndex((p) => /^v\d/.test(p));
  if (versionIdx > 0) return parts[versionIdx - 1];
  return parts[parts.length - 1];
}

/**
 * Build a map of descriptor path (e.g. "4,0,2,1") -> leading comment, from a file's
 * SourceCodeInfo. Only present when descriptors are built from source with comments.
 */
export function buildCommentMap(file: FileDescriptorProto): Map<string, string> {
  const map = new Map<string, string>();
  const info = file.sourceCodeInfo;
  if (!info) return map;
  for (const loc of info.location) {
    const comment = (loc.leadingComments ?? "").trim();
    if (comment) map.set(loc.path.join(","), comment);
  }
  return map;
}
