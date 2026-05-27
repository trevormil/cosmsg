/**
 * Curated set of chains for M1. Each entry maps to a Cosmos Chain Registry directory.
 * Optional `bufModule` / `protoPath` configure the build-from-source fallback path.
 */
export interface ChainSpec {
  /** Chain Registry directory name. */
  chainName: string;
  /** Buf Schema Registry module for the source build (preferred fallback; carries comments). */
  bufModule?: string;
  /** Proto directory within the git repo, if not the default "proto". */
  protoPath?: string;
}

export const ALLOWLIST: ChainSpec[] = [
  { chainName: "cosmoshub", bufModule: "buf.build/cosmos/cosmos-sdk" },
  { chainName: "osmosis" },
  { chainName: "juno" },
  { chainName: "neutron" },
  { chainName: "celestia" },
  { chainName: "injective" },
  { chainName: "stargaze" },
  { chainName: "akash" },
  { chainName: "kava" },
  { chainName: "evmos" },
  { chainName: "noble" },
  { chainName: "stride" },
];
