import type { Address } from "viem";

export type Token = { symbol: string; address: Address; decimals: number };
// mecenate is undefined until the contract is deployed on that chain (forge script script/Deploy.s.sol).
export type Chain = { id: string; name: string; explorer: string; mecenate?: Address; tokens: Token[] };

export const CHAINS: Chain[] = [
  {
    id: "0x2105", // 8453
    name: "Base",
    explorer: "https://basescan.org/tx/",
    tokens: [
      { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
      { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    ],
  },
  {
    id: "0x14a34", // 84532
    name: "Base Sepolia",
    explorer: "https://sepolia.basescan.org/tx/",
    tokens: [
      { symbol: "USDC", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", decimals: 6 },
      { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    ],
  },
];
// Signed once per session to derive the user's Mecenate keys; the bridge signs nothing else.
export const KEY_MESSAGE = "Mecenate encryption key v1\n\nSign only inside the Mecenate app: this signature decrypts the data you buy and sell.";
// Where bridge.html is published (GitHub Pages, see README). It must be a normal https origin, not Freenet.
export const BRIDGE_URL = "https://scobru.github.io/mecenate/bridge.html";
