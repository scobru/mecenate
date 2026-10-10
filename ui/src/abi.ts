import { parseAbi } from "viem";

const POST = "(address seller, uint64 period, uint16 ratio, uint8 status, address buyer, uint64 deadline, address token, uint256 stake, uint256 payment, bytes32 proofhash, string uri, bytes buyerKey, bytes encryptedKey, bytes revealedKey)";
const REQUEST = "(address buyer, uint64 minPeriod, uint16 maxRatio, address token, uint256 payment, uint256 minStake, bytes buyerKey, string description)";

export const mecenate = parseAbi([
  "function postCount() view returns (uint256)",
  "function feeBps() view returns (uint16)",
  "function requestCount() view returns (uint256)",
  `function getPost(uint256 id) view returns (${POST})`,
  `function getRequest(uint256 id) view returns (${REQUEST})`,
  "function stats(address seller) view returns (uint128 finalized, uint128 punished)",
  "function create(address token, uint256 stake, uint256 payment, uint16 ratio, uint64 period, bytes32 proofhash, string uri) returns (uint256)",
  "function accept(uint256 id, bytes buyerKey)",
  "function topUp(uint256 id, uint256 amount)",
  "function submit(uint256 id, bytes encryptedKey)",
  "function release(uint256 id)",
  "function punish(uint256 id, uint256 amount)",
  "function cancel(uint256 id)",
  "function reveal(uint256 id, bytes key, bytes32 dataHash, bytes32 cipherHash)",
  "function request(address token, uint256 payment, uint256 minStake, uint16 maxRatio, uint64 minPeriod, bytes buyerKey, string description) returns (uint256)",
  "function fill(uint256 requestId, uint256 postId)",
  "function cancelRequest(uint256 id)",
]);

export const erc20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function deposit() payable",
]);

export const STATUS = ["None", "Open", "Accepted", "Delivered", "Finalized", "Punished", "Cancelled"] as const;
