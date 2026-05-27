import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface BufSourceResult {
  bytes: Uint8Array;
  /** Human-readable description of what was built, for provenance. */
  origin: string;
}

/**
 * Build a FileDescriptorSet (with source-info comments) from a Buf Schema Registry module,
 * e.g. "buf.build/cosmos/cosmos-sdk". Requires the `buf` CLI on PATH.
 */
export async function buildFromBsr(module: string): Promise<BufSourceResult> {
  const out = join(await tmpRoot(), "set.binpb");
  await run("buf", ["build", module, "-o", out, "--as-file-descriptor-set"], {
    timeout: 180_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const bytes = await readFile(out);
  return { bytes, origin: `bsr:${module}` };
}

/**
 * Build a FileDescriptorSet from a chain's source repo: shallow-clone, then `buf build`
 * the proto directory (which carries leading comments via SourceCodeInfo).
 */
export async function buildFromGit(
  gitRepo: string,
  protoPath = "proto",
  ref?: string,
): Promise<BufSourceResult> {
  const dir = await tmpRoot();
  try {
    const cloneArgs = ["clone", "--depth", "1"];
    if (ref) cloneArgs.push("--branch", ref);
    cloneArgs.push(gitRepo, dir);
    await run("git", cloneArgs, { timeout: 180_000 });

    const out = join(await tmpRoot(), "set.binpb");
    await run(
      "buf",
      ["build", join(dir, protoPath), "-o", out, "--as-file-descriptor-set"],
      { timeout: 180_000, maxBuffer: 64 * 1024 * 1024 },
    );
    const bytes = await readFile(out);
    const head = (await run("git", ["-C", dir, "rev-parse", "HEAD"]))
      .stdout.trim()
      .slice(0, 12);
    return { bytes, origin: `git:${gitRepo}@${head}:${protoPath}` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function tmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cosmsg-"));
}
