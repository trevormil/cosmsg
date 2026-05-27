import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { MsgDef, QueryDef } from "@cosmsg/schema";
import { parseFileDescriptorSet } from "./parse.js";

/**
 * Build a deterministic FileDescriptorSet from the cosmos-sdk BSR module and assert the parser
 * extracts known Msgs/queries with the right shape. Skips gracefully if buf can't reach BSR.
 */
function buildCosmosSdkSet(): Uint8Array | null {
  const dir = mkdtempSync(join(tmpdir(), "cosmsg-test-"));
  const out = join(dir, "set.binpb");
  try {
    execFileSync(
      "buf",
      ["build", "buf.build/cosmos/cosmos-sdk", "-o", out, "--as-file-descriptor-set"],
      { timeout: 120_000, stdio: "pipe" },
    );
    return new Uint8Array(readFileSync(out));
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const set = buildCosmosSdkSet();
const maybe = set ? describe : describe.skip;

maybe("parseFileDescriptorSet (cosmos-sdk)", () => {
  const parsed = parseFileDescriptorSet(set!);

  it("extracts Msgs and queries", () => {
    expect(parsed.msgs.length).toBeGreaterThan(20);
    expect(parsed.queries.length).toBeGreaterThan(50);
  });

  it("every Msg/Query conforms to the schema", () => {
    for (const m of parsed.msgs) MsgDef.parse(m);
    for (const q of parsed.queries) QueryDef.parse(q);
  });

  it("recovers MsgSend with fields, signer, and comment", () => {
    const send = parsed.msgs.find(
      (m) => m.typeUrl === "/cosmos.bank.v1beta1.MsgSend",
    );
    expect(send).toBeDefined();
    expect(send!.module).toBe("bank");
    expect(send!.signers).toEqual(["from_address"]);
    const amount = send!.fields.find((f) => f.name === "amount");
    expect(amount?.repeated).toBe(true);
    expect(amount?.typeRef).toBe("cosmos.base.v1beta1.Coin");
    expect(send!.comment).toContain("send coins");
  });

  it("recovers the bank Balance query", () => {
    const bal = parsed.queries.find(
      (q) => q.service === "cosmos.bank.v1beta1.Query" && q.method === "Balance",
    );
    expect(bal).toBeDefined();
    expect(bal!.requestType).toBe("cosmos.bank.v1beta1.QueryBalanceRequest");
    expect(bal!.requestFields.map((f) => f.name)).toContain("address");
  });
});
