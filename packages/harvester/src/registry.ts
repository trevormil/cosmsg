const RAW_BASE =
  "https://raw.githubusercontent.com/cosmos/chain-registry/master";

export interface ResolvedChain {
  chainName: string;
  prettyName?: string;
  chainId?: string;
  sdkVersion?: string;
  /** gRPC endpoint authorities from the registry, e.g. "grpc.osmosis.zone:9090". */
  grpcEndpoints: string[];
  /** Source repo for the build-from-source fallback. */
  gitRepo?: string;
}

interface ApiEntry {
  address?: string;
}

interface ChainJson {
  pretty_name?: string;
  chain_id?: string;
  codebase?: {
    git_repo?: string;
    cosmos_sdk_version?: string;
    recommended_version?: string;
  };
  apis?: { grpc?: ApiEntry[] };
}

/** Fetch and normalize a chain's entry from the Cosmos Chain Registry. */
export async function resolveChain(chainName: string): Promise<ResolvedChain> {
  const url = `${RAW_BASE}/${chainName}/chain.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`registry fetch failed for ${chainName}: ${res.status}`);
  }
  const json = (await res.json()) as ChainJson;
  const grpcEndpoints = (json.apis?.grpc ?? [])
    .map((e) => e.address)
    .filter((a): a is string => typeof a === "string" && a.length > 0);

  return {
    chainName,
    prettyName: json.pretty_name,
    chainId: json.chain_id,
    sdkVersion:
      json.codebase?.cosmos_sdk_version ?? json.codebase?.recommended_version,
    grpcEndpoints,
    gitRepo: json.codebase?.git_repo,
  };
}
