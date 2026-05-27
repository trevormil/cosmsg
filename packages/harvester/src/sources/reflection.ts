import * as grpc from "@grpc/grpc-js";

export interface ReflectionResult {
  bytes: Uint8Array;
  origin: string;
}

const MAX_MSG = 256 * 1024 * 1024;
const DEADLINE_MS = 12_000;

/**
 * Bound a promise with a real setTimeout. The pending timer also keeps the event loop alive,
 * which matters under Bun: a hung grpc-js/http2 socket otherwise lets the process exit silently
 * before the await settles.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Harvest a chain's full FileDescriptorSet via gRPC reflection. Tries each endpoint in turn,
 * preferring the Cosmos ReflectionService (single call) and falling back to standard
 * v1alpha server reflection. Returns null if every endpoint fails.
 */
export async function harvestViaReflection(
  grpcEndpoints: string[],
): Promise<ReflectionResult | null> {
  for (const raw of grpcEndpoints) {
    const target = normalizeEndpoint(raw);
    if (!target) continue;
    for (const useTls of target.tlsCandidates) {
      const client = makeClient(target.authority, useTls);
      try {
        const bytes = await withTimeout(
          cosmosFileDescriptors(client),
          DEADLINE_MS,
          "FileDescriptors",
        );
        if (bytes && bytes.length > 0) {
          return { bytes, origin: `reflection:${target.authority}` };
        }
      } catch {
        /* fall through to v1alpha */
      } finally {
        client.close();
      }

      const client2 = makeClient(target.authority, useTls);
      try {
        const bytes = await withTimeout(
          serverReflectionV1alpha(client2),
          DEADLINE_MS,
          "ServerReflection",
        );
        if (bytes && bytes.length > 0) {
          return { bytes, origin: `reflection-v1alpha:${target.authority}` };
        }
      } catch {
        /* try next endpoint/tls */
      } finally {
        client2.close();
      }
    }
  }
  return null;
}

function makeClient(authority: string, tls: boolean): grpc.Client {
  const creds = tls
    ? grpc.credentials.createSsl()
    : grpc.credentials.createInsecure();
  return new grpc.Client(authority, creds, {
    "grpc.max_receive_message_length": MAX_MSG,
    "grpc.max_send_message_length": MAX_MSG,
  });
}

function deadline(): grpc.Deadline {
  return new Date(Date.now() + DEADLINE_MS);
}

/**
 * cosmos.reflection.v1.ReflectionService/FileDescriptors (unary, empty request).
 * The response's bytes are themselves a valid FileDescriptorSet (repeated FileDescriptorProto
 * at field 1), so we can hand them straight to the parser.
 */
function cosmosFileDescriptors(client: grpc.Client): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    client.makeUnaryRequest<Buffer, Buffer>(
      "/cosmos.reflection.v1.ReflectionService/FileDescriptors",
      (x) => x,
      (x) => x,
      Buffer.alloc(0),
      new grpc.Metadata(),
      { deadline: deadline() },
      (err, value) => {
        if (err || !value) return reject(err ?? new Error("empty"));
        resolve(new Uint8Array(value));
      },
    );
  });
}

/**
 * Standard grpc.reflection.v1alpha.ServerReflection: list services, then fetch the file
 * containing each service symbol, deduping files and wrapping them into a FileDescriptorSet.
 */
async function serverReflectionV1alpha(
  client: grpc.Client,
): Promise<Uint8Array> {
  const method = "/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo";
  const stream = client.makeBidiStreamRequest<Buffer, Buffer>(
    method,
    (x) => x,
    (x) => x,
    new grpc.Metadata(),
    { deadline: deadline() },
  );

  const responses: Buffer[] = [];
  const waiters: Array<(b: Buffer) => void> = [];
  let streamErr: Error | null = null;

  stream.on("data", (b: Buffer) => {
    const w = waiters.shift();
    if (w) w(b);
    else responses.push(b);
  });
  stream.on("error", (e: Error) => {
    streamErr = e;
  });

  const nextResponse = (): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      if (streamErr) return reject(streamErr);
      const b = responses.shift();
      if (b) return resolve(b);
      waiters.push(resolve);
    });

  // 1. list services
  stream.write(reflectionRequest(6, ""));
  const listResp = await nextResponse();
  const services = parseListServices(listResp);

  // 2. fetch file containing each service symbol
  const files = new Map<string, Uint8Array>();
  for (const svc of services) {
    stream.write(reflectionRequest(4, svc));
    const resp = await nextResponse();
    for (const fdp of parseFileDescriptorResponse(resp)) {
      const name = parseFileName(fdp);
      files.set(name, fdp);
    }
  }
  stream.end();

  return wrapFileDescriptorSet([...files.values()]);
}

function normalizeEndpoint(
  raw: string,
): { authority: string; tlsCandidates: boolean[] } | null {
  let s = raw.trim();
  let scheme = "";
  const m = /^(https?|grpcs?):\/\//.exec(s);
  if (m) {
    scheme = m[1]!;
    s = s.slice(m[0].length);
  }
  s = s.replace(/\/+$/, "");
  if (!s) return null;
  const hasPort = /:\d+$/.test(s);
  const authority = hasPort ? s : `${s}:443`;
  const port = authority.split(":").pop();
  const tlsLikely =
    scheme === "https" || scheme === "grpcs" || port === "443";
  // Try the likely transport first, then the other as a fallback.
  return {
    authority,
    tlsCandidates: tlsLikely ? [true, false] : [false, true],
  };
}

/* ---------- minimal protobuf wire helpers ---------- */

function encodeVarint(n: number): number[] {
  const out: number[] = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

/** Encode a ServerReflectionRequest with a single string field (field no, value). */
function reflectionRequest(fieldNo: number, value: string): Buffer {
  const valueBytes = Buffer.from(value, "utf8");
  const tag = (fieldNo << 3) | 2;
  return Buffer.from([
    tag,
    ...encodeVarint(valueBytes.length),
    ...valueBytes,
  ]);
}

interface WireField {
  no: number;
  wireType: number;
  data: Uint8Array;
}

/** Walk top-level fields of a protobuf message. */
function* walkFields(buf: Uint8Array): Generator<WireField> {
  let i = 0;
  while (i < buf.length) {
    let tag = 0;
    let shift = 0;
    for (; i < buf.length; i++) {
      const b = buf[i]!;
      tag |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) {
        i++;
        break;
      }
      shift += 7;
    }
    const no = tag >>> 3;
    const wireType = tag & 0x07;
    if (wireType === 2) {
      let len = 0;
      let s = 0;
      for (; i < buf.length; i++) {
        const b = buf[i]!;
        len |= (b & 0x7f) << s;
        if ((b & 0x80) === 0) {
          i++;
          break;
        }
        s += 7;
      }
      yield { no, wireType, data: buf.slice(i, i + len) };
      i += len;
    } else if (wireType === 0) {
      const start = i;
      while (i < buf.length && (buf[i]! & 0x80) !== 0) i++;
      i++;
      yield { no, wireType, data: buf.slice(start, i) };
    } else if (wireType === 5) {
      yield { no, wireType, data: buf.slice(i, i + 4) };
      i += 4;
    } else if (wireType === 1) {
      yield { no, wireType, data: buf.slice(i, i + 8) };
      i += 8;
    } else {
      break;
    }
  }
}

function readLenString(data: Uint8Array): string {
  return Buffer.from(data).toString("utf8");
}

/** ServerReflectionResponse field 6 -> ListServiceResponse field 1 (repeated) -> field 1 name. */
function parseListServices(resp: Uint8Array): string[] {
  const names: string[] = [];
  for (const f of walkFields(resp)) {
    if (f.no !== 6) continue;
    for (const svc of walkFields(f.data)) {
      if (svc.no !== 1) continue;
      for (const nameField of walkFields(svc.data)) {
        if (nameField.no === 1) names.push(readLenString(nameField.data));
      }
    }
  }
  return names;
}

/** ServerReflectionResponse field 4 -> FileDescriptorResponse field 1 (repeated bytes). */
function parseFileDescriptorResponse(resp: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const f of walkFields(resp)) {
    if (f.no !== 4) continue;
    for (const fd of walkFields(f.data)) {
      if (fd.no === 1) out.push(fd.data);
    }
  }
  return out;
}

/** FileDescriptorProto field 1 = name (string). */
function parseFileName(fdp: Uint8Array): string {
  for (const f of walkFields(fdp)) {
    if (f.no === 1) return readLenString(f.data);
  }
  return "";
}

/** Wrap FileDescriptorProto byte-blobs into a serialized FileDescriptorSet (repeated field 1). */
function wrapFileDescriptorSet(files: Uint8Array[]): Uint8Array {
  const chunks: number[] = [];
  for (const f of files) {
    chunks.push(0x0a, ...encodeVarint(f.length)); // tag for field 1, wireType 2
    chunks.push(...f);
  }
  return Uint8Array.from(chunks);
}
