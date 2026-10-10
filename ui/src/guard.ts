import { decodeFunctionData, getAddress, toHex, type Hex } from "viem";
import { erc20, mecenate } from "./abi.ts";
import { CHAINS, KEY_MESSAGE } from "./config.ts";

// The bridge lends its origin's wallet connection to whatever window opened it, so it only relays what Mecenate
// itself needs: reads, the supported chains, the key message, Mecenate calls and token approvals for Mecenate.
const READS = new Set(["eth_chainId", "eth_accounts", "eth_requestAccounts", "eth_call", "eth_getBalance", "eth_getCode", "eth_getTransactionReceipt", "eth_blockNumber", "eth_estimateGas"]);

/** Why the bridge refuses this request, or undefined if it may go to the wallet. */
export function refuse(method: string, params: unknown[] = [], account?: string): string | undefined {
  if (READS.has(method)) return;
  if (method === "wallet_switchEthereumChain") return CHAINS.some((c) => c.id === (params[0] as { chainId?: string })?.chainId) ? undefined : "Unsupported chain";
  try {
    if (method === "personal_sign") {
      if (params[0] !== toHex(KEY_MESSAGE)) return "Only the Mecenate key message can be signed";
      if (!account || getAddress(params[1] as string) !== getAddress(account)) return "Signer is not the connected account";
      return;
    }
    if (method !== "eth_sendTransaction") return `${method} is not allowed`;
    const tx = params[0] as { from?: string; to?: string; data?: Hex; value?: string; chainId?: string };
    if (!account || getAddress(tx.from!) !== getAddress(account)) return "Sender is not the connected account";
    if (BigInt(tx.value ?? 0)) return "Mecenate never sends ETH";
    // The wallet rejects a chainId that isn't its current chain, so a chain switch mid-flow can't hit the wrong contract.
    const chain = CHAINS.find((c) => c.id === tx.chainId?.toLowerCase());
    if (!chain?.mecenate) return "Transaction must name a chain where Mecenate is deployed";
    const to = getAddress(tx.to!), app = getAddress(chain.mecenate);
    if (to === app) { decodeFunctionData({ abi: mecenate, data: tx.data! }); return; } // throws on anything not in the ABI
    if (!chain.tokens.some((t) => getAddress(t.address) === to)) return "Only the Mecenate contract and listed tokens";
    const c = decodeFunctionData({ abi: erc20, data: tx.data! });
    if (c.functionName !== "approve" || getAddress(c.args[0]) !== app) return "Only a token approval for Mecenate";
  } catch {
    return "Unrecognized request";
  }
}
