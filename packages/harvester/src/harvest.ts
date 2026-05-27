import { ChainCatalog } from "@cosmsg/schema";
import type { ChainSpec } from "./allowlist.js";
import { parseFileDescriptorSet } from "./parse.js";
import { resolveChain } from "./registry.js";
import { buildFromBsr, buildFromGit } from "./sources/buf-source.js";
import { harvestViaReflection } from "./sources/reflection.js";

export type Prefer = "reflection" | "source";

interface RawHarvest {
  bytes: Uint8Array;
  source: "reflection" | "source";
  origin: string;
}

/** Harvest a single chain into a validated ChainCatalog. */
export async function harvestChain(
  spec: ChainSpec,
  prefer: Prefer = "reflection",
): Promise<ChainCatalog> {
  const chain = await resolveChain(spec.chainName);

  const tryReflection = async (): Promise<RawHarvest | null> => {
    if (chain.grpcEndpoints.length === 0) return null;
    const r = await harvestViaReflection(chain.grpcEndpoints);
    return r ? { ...r, source: "reflection" } : null;
  };

  const trySource = async (): Promise<RawHarvest | null> => {
    if (spec.bufModule) {
      const r = await buildFromBsr(spec.bufModule);
      return { ...r, source: "source" };
    }
    if (chain.gitRepo) {
      const r = await buildFromGit(chain.gitRepo, spec.protoPath);
      return { ...r, source: "source" };
    }
    return null;
  };

  const order =
    prefer === "reflection"
      ? [tryReflection, trySource]
      : [trySource, tryReflection];

  let raw: RawHarvest | null = null;
  const errors: string[] = [];
  for (const attempt of order) {
    try {
      raw = await attempt();
      if (raw) break;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (!raw) {
    throw new Error(
      `no source succeeded for ${spec.chainName}${errors.length ? `: ${errors.join("; ")}` : ""}`,
    );
  }

  const { msgs, queries, hasComments } = parseFileDescriptorSet(raw.bytes);

  return ChainCatalog.parse({
    chainName: chain.chainName,
    prettyName: chain.prettyName,
    chainId: chain.chainId,
    sdkVersion: chain.sdkVersion,
    provenance: {
      source: raw.source,
      harvestedAt: new Date().toISOString(),
      origin: raw.origin,
      commentsFromSource: raw.source === "source" && hasComments,
    },
    msgs,
    queries,
  });
}
