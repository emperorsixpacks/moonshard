import test from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, custom, encodeAbiParameters, encodeFunctionResult } from "viem";
import { createChain, engagementAbi } from "../src/chain.js";

// "Can this player claim the bounty?" has three kinds of answer, and the game treats them very differently:
//   yes / no   the contract answered (a "no" is a bool, or a revert with a reason such as a cooldown)
//   unknown    the RPC node did not answer at all (down, timed out)
// An outage used to read as "no" (ok:false with the transport's error text), so the claim button disappeared and the panel
// showed "HTTP request failed." as if the reward were refused. Review finding.

const APP = "0x1111111111111111111111111111111111111111";
const USER = "0x2222222222222222222222222222222222222222";
const config = { rpcUrl: "http://unused.invalid", contracts: { identity: APP, engagement: APP, vault: "" } };

const chainWith = (request) => createChain(config, { client: createPublicClient({ transport: custom({ request }, { retryCount: 0 }) }) });

// The standard Error(string) a reverting contract returns: selector 0x08c379a0, then the ABI-encoded reason
const revertData = (reason) => `0x08c379a0${encodeAbiParameters([{ type: "string" }], [reason]).slice(2)}`;
const revert = (reason) => Object.assign(new Error(`execution reverted: ${reason}`), { code: 3, data: revertData(reason) });

test("the contract says yes: ok", async () => {
  const chain = chainWith(async () => encodeFunctionResult({ abi: engagementAbi, functionName: "canClaim", result: true }));
  assert.deepEqual(await chain.canClaimEngagement(APP, USER), { ok: true, reason: null });
});

test("the contract says no with a bool: not ok, not_claimable", async () => {
  const chain = chainWith(async () => encodeFunctionResult({ abi: engagementAbi, functionName: "canClaim", result: false }));
  assert.deepEqual(await chain.canClaimEngagement(APP, USER), { ok: false, reason: "not_claimable" });
});

test("the contract says no with a revert: not ok, with the contract's reason", async () => {
  const chain = chainWith(async () => { throw revert("Claim cooldown not reached"); });
  assert.deepEqual(await chain.canClaimEngagement(APP, USER), { ok: false, reason: "Claim cooldown not reached" });
});

test("the node does not answer: unknown, never 'not claimable'", async () => {
  for (const failure of [new Error("HTTP request failed."), Object.assign(new Error("The request timed out."), { name: "TimeoutError" })]) {
    const chain = chainWith(async () => { throw failure; });
    assert.deepEqual(await chain.canClaimEngagement(APP, USER), { ok: null, reason: "chain_unavailable" }, failure.message);
  }
});
