import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeFunctionData, toFunctionSelector, toHex, type AbiFunction, type Hex } from "viem";
import { erc20, mecenate } from "./abi.ts";
import { CHAINS, KEY_MESSAGE } from "./config.ts";
import { encryptFile, keysFrom, openFile, seal, sellerOpen, unseal } from "./crypto.ts";
import { refuse } from "./guard.ts";

// Full sale: seller encrypts, buyer receives the sealed key, opens the file, checks the proofhash.
const seller = keysFrom(`0x${"11".repeat(65)}`), buyer = keysFrom(`0x${"22".repeat(65)}`);
const data = new TextEncoder().encode("the secret");
const { file, proof } = encryptFile(seller.seed, data);
const { key } = sellerOpen(seller.seed, file, proof);
const got = openFile(unseal(seal(key, buyer.pub), buyer.priv), file, proof);
assert.equal(new TextDecoder().decode(got.data), "the secret");
assert.deepEqual(keysFrom(`0x${"11".repeat(65)}`).pub, seller.pub, "keys are deterministic");
assert.throws(() => unseal(seal(key, buyer.pub), seller.priv), /not encrypted to your key/);
assert.throws(() => sellerOpen(buyer.seed, file, proof), /does not open/);
const tampered = file.slice(); tampered[40] ^= 1;
assert.throws(() => openFile(key, tampered, proof), /does not open/);
assert.throws(() => openFile(key, file, `0x${"00".repeat(32)}`), /proofhash/);

// The ABI the app uses matches the compiled contract (run `npm run build` in the root first).
const built = JSON.parse(readFileSync(new URL("../../artifacts/src/Mecenate.sol/Mecenate.json", import.meta.url), "utf8")).abi as AbiFunction[];
const sel = (abi: readonly unknown[]) => new Set((abi as AbiFunction[]).filter((f) => f.type === "function").map((f) => toFunctionSelector(f)));
const contract = sel(built);
for (const s of sel(mecenate)) assert.ok(contract.has(s), `app ABI function ${s} not in contract`);
// Selectors cover inputs only; the structs the app decodes by field name must also match field by field.
const fields = (abi: readonly unknown[], name: string) => JSON.stringify((abi as AbiFunction[]).find((f) => f.name === name)!.outputs.map((o) => ("components" in o ? o.components : o)).flat().map((c) => [c.name, c.type]));
for (const f of ["getPost", "getRequest", "stats"]) assert.equal(fields(mecenate, f), fields(built, f), `${f} fields differ from the contract`);

// Guard: what the bridge relays.
const app = "0x00000000000000000000000000000000000000aa";
CHAINS[1].mecenate = app;
const me = "0x00000000000000000000000000000000000000bb";
const usdc = CHAINS[1].tokens[0].address;
const tx = (to: string, data: Hex, extra = {}) => [{ from: me, to, data, value: "0x0", chainId: CHAINS[1].id, ...extra }];
assert.equal(refuse("eth_call"), undefined);
assert.equal(refuse("personal_sign", [toHex(KEY_MESSAGE), me], me), undefined);
assert.match(refuse("personal_sign", [toHex("login to evil"), me], me)!, /Only the Mecenate key/);
assert.match(refuse("eth_signTypedData_v4", [], me)!, /not allowed/);
assert.equal(refuse("eth_sendTransaction", tx(app, encodeFunctionData({ abi: mecenate, functionName: "release", args: [1n] })), me), undefined);
assert.equal(refuse("eth_sendTransaction", tx(usdc, encodeFunctionData({ abi: erc20, functionName: "approve", args: [app, 5n] })), me), undefined);
assert.match(refuse("eth_sendTransaction", tx(usdc, encodeFunctionData({ abi: erc20, functionName: "approve", args: [me, 5n] })), me)!, /approval for Mecenate/);
assert.match(refuse("eth_sendTransaction", tx(app, "0xdeadbeef"), me)!, /Unrecognized/);
assert.match(refuse("eth_sendTransaction", tx(app, encodeFunctionData({ abi: mecenate, functionName: "release", args: [1n] }), { value: "0x1" }), me)!, /never sends ETH/);
assert.match(refuse("eth_sendTransaction", tx(app, encodeFunctionData({ abi: mecenate, functionName: "release", args: [1n] }), { chainId: CHAINS[0].id }), me)!, /deployed/);
assert.match(refuse("eth_sendTransaction", tx(app, encodeFunctionData({ abi: mecenate, functionName: "release", args: [1n] })), usdc)!, /Sender/);
console.log("ok");
