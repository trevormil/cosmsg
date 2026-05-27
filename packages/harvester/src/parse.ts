import { fromBinary } from "@bufbuild/protobuf";
import {
  FileDescriptorSetSchema,
  type DescriptorProto,
  type FileDescriptorProto,
} from "@bufbuild/protobuf/wkt";
import type { FieldDef, MsgDef, QueryDef, TypeDef } from "@cosmsg/schema";
import {
  buildCommentMap,
  fieldTypeName,
  hasMsgServiceOption,
  isOptional,
  isRepeated,
  moduleFromPackage,
  readHttpPath,
  readSigners,
  stripLeadingDot,
} from "./proto-util.js";

interface MessageEntry {
  desc: DescriptorProto;
  file: FileDescriptorProto;
  /** SourceCodeInfo path to this message, e.g. [4, 0] or [4, 0, 3, 1] for nested. */
  path: number[];
}

export interface ParsedCatalog {
  msgs: MsgDef[];
  queries: QueryDef[];
  /** Every proto message type (so referenced types like CollectionApproval are browsable). */
  types: TypeDef[];
  /** Whether any leading comments were recovered (true only with source-info). */
  hasComments: boolean;
}

/** Packages we don't surface as standalone types (well-known / annotation-only). */
const SKIP_TYPE_PACKAGES = ["google.protobuf", "google.api", "gogoproto"];

/** Parse a serialized FileDescriptorSet into a normalized Msg/Query catalog. */
export function parseFileDescriptorSet(bytes: Uint8Array): ParsedCatalog {
  const set = fromBinary(FileDescriptorSetSchema, bytes);

  // Index every message type by fully-qualified name for request/field resolution.
  const messages = new Map<string, MessageEntry>();
  const commentMaps = new Map<FileDescriptorProto, Map<string, string>>();
  for (const file of set.file) {
    commentMaps.set(file, buildCommentMap(file));
    file.messageType.forEach((m, i) =>
      indexMessage(messages, file, m, file.package, [4, i]),
    );
  }

  let hasComments = false;
  const msgs: MsgDef[] = [];
  const queries: QueryDef[] = [];

  for (const file of set.file) {
    const pkg = file.package;
    const module = moduleFromPackage(pkg);
    file.service.forEach((svc, svcIdx) => {
      const isMsgService =
        svc.name === "Msg" || hasMsgServiceOption(svc.options);
      svc.method.forEach((method, methodIdx) => {
        const methodComment = commentFor(commentMaps, file, [
          6,
          svcIdx,
          2,
          methodIdx,
        ]);
        if (methodComment) hasComments = true;

        if (isMsgService) {
          const reqName = stripLeadingDot(method.inputType);
          const entry = messages.get(reqName);
          const fields = entry ? extractFields(entry, messages, commentMaps) : [];
          const signers = entry ? readSigners(entry.desc.options) : [];
          const msgComment =
            (entry && commentFor(commentMaps, entry.file, entry.path)) ||
            methodComment;
          if (msgComment) hasComments = true;
          msgs.push({
            typeUrl: `/${reqName}`,
            name: reqName.split(".").pop() ?? reqName,
            package: pkg,
            module,
            signers: signers.length ? signers : undefined,
            fields,
            comment: msgComment || undefined,
          });
        } else {
          const reqName = stripLeadingDot(method.inputType);
          const entry = messages.get(reqName);
          const fields = entry ? extractFields(entry, messages, commentMaps) : [];
          queries.push({
            service: `${pkg}.${svc.name}`,
            method: method.name,
            package: pkg,
            module,
            requestType: reqName,
            responseType: stripLeadingDot(method.outputType),
            requestFields: fields,
            httpPath: readHttpPath(method.options),
            comment: methodComment || undefined,
          });
        }
      });
    });
  }

  // Emit every message type (excluding synthetic map-entries and well-known/annotation packages),
  // so fields referencing types like badges.CollectionApproval are browsable.
  const types: TypeDef[] = [];
  for (const [fullName, entry] of messages) {
    if (entry.desc.options?.mapEntry) continue;
    const pkg = entry.file.package;
    if (SKIP_TYPE_PACKAGES.some((p) => pkg === p || pkg.startsWith(`${p}.`)))
      continue;
    const comment = commentFor(commentMaps, entry.file, entry.path);
    if (comment) hasComments = true;
    types.push({
      fullName,
      name: fullName.split(".").pop() ?? fullName,
      package: pkg,
      module: moduleFromPackage(pkg),
      fields: extractFields(entry, messages, commentMaps),
      comment: comment || undefined,
    });
  }
  types.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return { msgs, queries, types, hasComments };
}

function indexMessage(
  map: Map<string, MessageEntry>,
  file: FileDescriptorProto,
  desc: DescriptorProto,
  parentName: string,
  path: number[],
): void {
  const fqName = parentName ? `${parentName}.${desc.name}` : desc.name;
  map.set(fqName, { desc, file, path });
  desc.nestedType.forEach((nested, i) =>
    indexMessage(map, file, nested, fqName, [...path, 3, i]),
  );
}

function extractFields(
  entry: MessageEntry,
  _messages: Map<string, MessageEntry>,
  commentMaps: Map<FileDescriptorProto, Map<string, string>>,
): FieldDef[] {
  return entry.desc.field.map((f, i) => {
    const typeRef = f.typeName ? stripLeadingDot(f.typeName) : undefined;
    const comment = commentFor(commentMaps, entry.file, [...entry.path, 2, i]);
    return {
      name: f.name,
      type: fieldTypeName(f),
      number: f.number,
      repeated: isRepeated(f),
      optional: isOptional(f),
      typeRef,
      comment: comment || undefined,
    };
  });
}

function commentFor(
  commentMaps: Map<FileDescriptorProto, Map<string, string>>,
  file: FileDescriptorProto,
  path: number[],
): string {
  return commentMaps.get(file)?.get(path.join(",")) ?? "";
}
