import { decodeFunctionResult, encodeFunctionData, formatUnits, getAddress, hexToBytes, parseUnits, toHex, type Abi, type Address, type Hex } from "viem";
import { erc20, mecenate, STATUS } from "./abi.ts";
import { BRIDGE_URL, CHAINS, KEY_MESSAGE, type Chain, type Token } from "./config.ts";
import { encryptFile, keysFrom, openFile, seal, sellerOpen, unseal, type Keys } from "./crypto.ts";
import { download as fromFreenet, makeUri, parseUri, upload as toFreenet } from "./freenet.ts";
import { STYLE } from "./style.ts";

// Wallet-only: the Freenet sandbox blocks fetch to external RPCs, so every read and write goes through the wallet.
type Eip1193 = { request(a: { method: string; params?: unknown[] }): Promise<unknown> };

// Wallet extensions can't answer inside the Freenet sandbox (opaque origin), so bridge.html, served from a normal
// origin and opened as a popup, relays each request to the wallet there.
const BRIDGE_ORIGIN = new URL(BRIDGE_URL).origin;
let popup: Window | null = null, popupReady: Promise<void> | undefined, onReady = () => {}, isReady = false, nextId = 1;
const waiting = new Map<number, (m: { result?: unknown; error?: { code?: number; message?: string } }) => void>();
addEventListener("message", (e) => {
  if (!popup || e.source !== popup || e.origin !== BRIDGE_ORIGIN) return;
  const id = e.data?.mecenateBridge;
  if (id === "ready") { isReady = true; onReady(); }
  // A ready bridge closing or reloading: wait for its next "ready" (a really closed one is reopened via popup.closed).
  // The "closed" of the bridge a fresh window.open replaces is ignored, or it would orphan that open's wait.
  else if (id === "closed" && isReady) { isReady = false; popupReady = new Promise((r) => (onReady = r)); }
  else { waiting.get(id)?.(e.data); waiting.delete(id); }
});
const bridge: Eip1193 = {
  request({ method, params }) {
    if (!popup || popup.closed) {
      // A fresh URL each time: browsers kept serving a stale bridge.html (whose old script was gone) after a deploy.
      popup = window.open(`${BRIDGE_URL}?t=${Date.now()}`, "mecenate-bridge", "popup,width=420,height=600"); // needs this click's user activation
      if (!popup) return Promise.reject(new Error("The wallet popup was blocked. Allow popups for Mecenate and try again."));
      isReady = false;
      popupReady = new Promise((r) => (onReady = r));
    }
    const id = nextId++;
    return popupReady!.then(() => new Promise((ok, no) => {
      waiting.set(id, (m) => (m.error ? no(Object.assign(new Error(m.error.message), m.error)) : ok(m.result)));
      popup!.focus();
      popup!.postMessage({ id, method, params }, BRIDGE_ORIGIN);
    }));
  },
};
const rpc = <T>(method: string, params: unknown[] = [], ms = 20_000) => Promise.race([
  bridge.request({ method, params }) as Promise<T>,
  new Promise<never>((_, no) => setTimeout(() => no(new Error(`Wallet did not answer ${method} within ${ms / 1000}s.`)), ms)),
]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const read = async (abi: Abi, to: Address, functionName: string, args: unknown[] = []): Promise<any> =>
  decodeFunctionResult({ abi, functionName, data: await rpc<Hex>("eth_call", [{ to, data: encodeFunctionData({ abi, functionName, args }) }, "latest"]) } as never);

type Post = { seller: Address; period: bigint; ratio: number; status: number; buyer: Address; deadline: bigint; token: Address; stake: bigint; payment: bigint; proofhash: Hex; uri: string; buyerKey: Hex; encryptedKey: Hex; revealedKey: Hex };
type Request = { buyer: Address; minPeriod: bigint; maxRatio: number; token: Address; payment: bigint; minStake: bigint; buyerKey: Hex; description: string };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const val = (id: string) => $<HTMLInputElement>(id).value.trim();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (v: bigint, d: number) => { const [i, f = ""] = formatUnits(v, d).split("."); return f ? `${i}.${f.slice(0, 6).replace(/0+$/, "")}`.replace(/\.$/, "") : i; };
const days = (s: bigint) => `${Number(s) / 86400} d`;
const when = (t: bigint) => new Date(Number(t) * 1000).toLocaleString();
const now = () => BigInt(Math.floor(Date.now() / 1000));

document.head.append(Object.assign(document.createElement("style"), { textContent: STYLE }));
const tokenSelect = (id: string) => `<select id="${id}" aria-label="Token"></select>`;
$("app").innerHTML = `
  <header>
    <div class="brand"><span class="logo">M</span>Mecenate</div>
    <nav id="chains" class="pills"></nav>
  </header>
  <nav class="tabs" role="tablist">
    <button type="button" data-tab="market" class="on">Market</button><button type="button" data-tab="sell">Sell</button><button type="button" data-tab="bay">Bay</button>
  </nav>
  <button id="connect" class="primary" type="button">Connect wallet</button>
  <p id="msg" role="status"></p>
  <section id="market" class="tab"><div id="posts"></div></section>
  <section id="sell" class="tab card" hidden>
    <h2>Sell data</h2>
    <ol class="steps"><li>Pick the file: it is encrypted here and the ciphertext is published on Freenet. Only buyers get the key.</li><li>Stake behind it. Buyers get the key only after paying; until the window closes they can burn your stake.</li><li>Keep your Freenet node running for a while so others can fetch the ciphertext.</li></ol>
    <label>File<input id="sFile" type="file"></label>
    <label>What it is<input id="sUri" placeholder="Weekly picks, 12 KB text"></label>
    <div class="row"><label>Token${tokenSelect("sTok")}</label><label>Price<input id="sPay" inputmode="decimal" placeholder="10"></label><label>Your stake<input id="sStake" inputmode="decimal" placeholder="5"></label></div>
    <div class="row"><label>Punish cost %<input id="sRatio" inputmode="decimal" value="10"></label><label>Window, days<input id="sDays" inputmode="decimal" value="3"></label></div>
    <p class="muted">Punish cost: what the buyer burns of their own per unit of your stake. Window: how long you have to deliver, then how long the buyer has to punish.</p>
    <button id="sGo" class="primary" type="button">Create post</button>
  </section>
  <section id="bay" class="tab" hidden>
    <div class="card">
      <h2>Request data</h2>
      <label>What you are looking for<input id="rDesc" placeholder="Describe it; links and handles are fine"></label>
      <div class="row"><label>Token${tokenSelect("rTok")}</label><label>Reward<input id="rPay" inputmode="decimal" placeholder="10"></label><label>Min seller stake<input id="rStake" inputmode="decimal" placeholder="5"></label></div>
      <div class="row"><label>Max punish cost %<input id="rRatio" inputmode="decimal" value="10"></label><label>Min window, days<input id="rDays" inputmode="decimal" value="3"></label></div>
      <p class="muted">The reward is escrowed now. A seller fills the request with a post that meets these terms; you can withdraw it until then.</p>
      <button id="rGo" class="primary" type="button">Escrow reward</button>
    </div>
    <div id="requests"></div>
  </section>
  <footer>
    <button id="how" class="link" type="button">How it works</button>
    <p class="muted">Griefing escrow on ${CHAINS.map((c) => c.name).join(" and ")}, served from Freenet. Unaudited: use small amounts.</p>
    <p class="love"><a href="https://github.com/scobru/mecenate" target="_blank" rel="noopener noreferrer">github.com/scobru/mecenate</a> · Made with <span aria-label="love">♥</span> by <a href="https://scobrudot.dev" target="_blank" rel="noopener noreferrer">scobru</a></p>
  </footer>
  <dialog id="howto" aria-labelledby="howTitle">
    <h2 id="howTitle">How it works</h2>
    <p class="muted">Sell data to strangers without trusting them: the seller puts money at stake, and an unhappy buyer can burn it, at a cost.</p>
    <ol class="flow">
      <li><b>Sell</b><span>Your file is encrypted in this page and the ciphertext goes on Freenet. The post, onchain, commits to the file, the key and the ciphertext, and holds your stake.</span></li>
      <li><b>Buy</b><span>The buyer pays into the contract. You have the window to deliver, or they can take their money back.</span></li>
      <li><b>Deliver</b><span>The app sends the key, encrypted so only the buyer can open it. From now on the payment sits with your stake: no refunds.</span></li>
      <li><b>Release or punish</b><span>The buyer decrypts and checks the file matches the commitment. They release (you get stake + price), or within the window burn part of your stake, paying the punish cost % of it themselves. If they do nothing, anyone can release after the window.</span></li>
      <li><b>Make public</b><span>Optionally, after the sale, publish the key so anyone can decrypt.</span></li>
    </ol>
    <h3>Bay</h3>
    <p class="muted">Buyers can post what they look for with an escrowed reward and their terms. A seller fills it with a matching post, and the sale goes on as above.</p>
    <h3>Under the hood</h3>
    <ul>
      <li><b>Freenet</b> serves this page and stores ciphertexts as content-addressed chunks. Keep your node running so buyers can fetch yours.</li>
      <li><b>Wallet popup</b>: wallets can't reach Freenet's sandbox, so a small page on GitHub Pages relays the app's requests to your wallet. It only passes on reads, Mecenate calls, approvals for Mecenate, wrapping ETH into WETH and the key message. Everything else is refused.</li>
      <li><b>Your keys</b> come from one signature of a fixed message: nothing is stored. Sign it only here: it decrypts what you bought.</li>
      <li><b>Seller record</b> shows sales released and punished. It is onchain but can be padded by selling to yourself, so weigh the stake more than the count.</li>
    </ul>
    <form method="dialog"><button class="primary" type="submit">Got it</button></form>
  </dialog>`;

let chain: Chain = CHAINS.find((c) => c.mecenate) ?? CHAINS[0], account: Address | undefined, keys: Keys | undefined, busy = false, cipher: { source: File; proof: Hex; addr: string } | undefined;
const verified = new Set<string>();
const ready = () => !!account && verified.has(chain.id);
const say = (t: string, link?: string) => { $("msg").textContent = t; if (link) $("msg").append(" ", Object.assign(document.createElement("a"), { href: link, target: "_blank", rel: "noopener", textContent: "View" })); };
const POPUP = "the wallet popup (click its button)";
const tokenOf = (a: Address) => chain.tokens.find((t) => getAddress(t.address) === getAddress(a));
const pickedToken = (id: string) => chain.tokens[$<HTMLSelectElement>(id).selectedIndex];
const amount = (id: string, t: Token) => { const v = parseUnits(val(id) || "0", t.decimals); if (v <= 0n) throw new Error("Enter an amount above 0"); return v; };
const percentBps = (id: string) => { const v = Math.round(Number(val(id)) * 100); if (!(v >= 0 && v <= 65535)) throw new Error("Percent must be between 0 and 655"); return v; };
const seconds = (id: string) => { const v = Number(val(id)); if (!(v > 0)) throw new Error("Days must be above 0"); return BigInt(Math.round(v * 86400)); };

async function ensureChain() {
  if ((await rpc<string>("eth_chainId")) !== chain.id) {
    say(`Switch your wallet to ${chain.name} in ${POPUP}…`);
    await rpc("wallet_switchEthereumChain", [{ chainId: chain.id }], 60_000);
  }
  if ((await rpc<string>("eth_chainId")) !== chain.id) throw new Error(`Wallet is not on ${chain.name}`);
  if (verified.has(chain.id)) return;
  if (!chain.mecenate) throw new Error(`Mecenate is not deployed on ${chain.name} yet.`);
  if ((await rpc<string>("eth_getCode", [chain.mecenate, "latest"])) === "0x") throw new Error(`No Mecenate contract at the configured address on ${chain.name}`);
  for (const t of chain.tokens) if (Number(await read(erc20, t.address, "decimals")) !== t.decimals) throw new Error(`${t.symbol} decimals mismatch, disabled`);
  verified.add(chain.id);
}

async function connect() {
  say(`Approve the connection in ${POPUP}…`);
  account = getAddress((await rpc<Address[]>("eth_requestAccounts", [], 60_000))[0]);
  await ensureChain();
  say(`Connected ${short(account)} on ${chain.name}`);
}

async function getKeys() {
  if (!keys) {
    say(`Sign the Mecenate key message in ${POPUP}: it derives your encryption keys, nothing is sent onchain.`);
    keys = keysFrom(await rpc<Hex>("personal_sign", [toHex(KEY_MESSAGE), account], 120_000));
  }
  return keys;
}

async function send(to: Address, data: Hex, value = 0n) {
  const tx = { from: account, to, data, value: `0x${value.toString(16)}`, chainId: chain.id };
  // Simulate first: a call that would revert fails here with its reason, not as a wallet that "can't estimate gas".
  try { await rpc("eth_estimateGas", [tx]); }
  catch (e) { throw new Error(`This transaction would fail: ${(e as Error).message}`); }
  const hash = await rpc<Hex>("eth_sendTransaction", [tx], 180_000);
  say("Pending…", chain.explorer + hash);
  for (let i = 0; i < 90; i++) {
    const r = await rpc<{ status: string } | null>("eth_getTransactionReceipt", [hash]);
    if (r) { if (r.status !== "0x1") throw new Error("Transaction reverted: " + hash); return hash; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Timed out waiting for " + hash);
}
const call = (functionName: string, args: unknown[]) => send(chain.mecenate!, encodeFunctionData({ abi: mecenate, functionName, args } as never));
/** Makes sure `need` of `t` can be pulled by Mecenate: enough balance (wrapping ETH into WETH if short) and allowance. */
async function allow(t: Token, need: bigint) {
  const have: bigint = await read(erc20, t.address, "balanceOf", [account]);
  if (have < need) {
    if (!t.wraps) throw new Error(`Not enough ${t.symbol}: you have ${fmt(have, t.decimals)}, this needs ${fmt(need, t.decimals)}.`);
    say(`Wrap ${fmt(need - have, 18)} ETH into WETH in ${POPUP}…`);
    await send(t.address, encodeFunctionData({ abi: erc20, functionName: "deposit" }), need - have);
  }
  if ((await read(erc20, t.address, "allowance", [account, chain.mecenate])) >= need) return;
  say(`Approve ${fmt(need, t.decimals)} ${t.symbol} for Mecenate in ${POPUP}…`);
  await send(t.address, encodeFunctionData({ abi: erc20, functionName: "approve", args: [chain.mecenate!, need] })); // exact amount, never unlimited
}

/** Opens the file picker; must run before any await so the click still counts as user activation. */
const pickFile = () => new Promise<{ bytes: Uint8Array; name: string }>((ok, no) => {
  const input = Object.assign(document.createElement("input"), { type: "file" });
  input.onchange = async () => { const f = input.files?.[0]; if (f) ok({ bytes: new Uint8Array(await f.arrayBuffer()), name: f.name }); else no(new Error("No file chosen")); };
  input.click();
});
const download = (bytes: Uint8Array, name: string) => {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([bytes as BlobPart])), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
};

// ---- market ----

type Picked = Promise<{ bytes: Uint8Array; name: string }>;
const freenetAddr = (p: Post) => parseUri(p.uri).addr;
/** The post's ciphertext: from Freenet when the post points there, else the file the user picked. */
async function ciphertext(id: bigint, p: Post, file?: Picked) {
  const addr = freenetAddr(p);
  if (!addr) return file!;
  const bytes = await fromFreenet(addr, (i, n) => say(`Fetching post #${id} from Freenet… ${i}/${n}`));
  return { bytes, name: `post-${id}` };
}
const actions: Record<string, (id: bigint, p: Post, file?: Picked) => Promise<void>> = {
  async buy(id, p) {
    const t = tokenOf(p.token)!, { pub } = await getKeys();
    await allow(t, p.payment);
    say(`Pay ${fmt(p.payment, t.decimals)} ${t.symbol} in ${POPUP}…`);
    await call("accept", [id, pub]);
    say(`Bought post #${id}. The seller has ${days(p.period)} to deliver.`);
  },
  async deliver(id, p, file) {
    const f = await ciphertext(id, p, file), k = await getKeys();
    const { key } = sellerOpen(k.seed, f.bytes, p.proofhash); // also proves this is the file the post committed to
    say(`Deliver the key for post #${id} in ${POPUP}…`);
    await call("submit", [id, seal(key, p.buyerKey)]);
    say(`Delivered. The buyer has ${days(p.period)} to release or punish; after that anyone can release your stake.`);
  },
  async decrypt(id, p, file) {
    const f = await ciphertext(id, p, file);
    const key = p.revealedKey !== "0x" ? hexToBytes(p.revealedKey) : unseal(p.encryptedKey, (await getKeys()).priv);
    const { data } = openFile(key, f.bytes, p.proofhash);
    download(data, f.name.replace(/\.mecenate$/, "") || `post-${id}`);
    say(`Decrypted post #${id}: the file matches what the seller committed to.`);
  },
  async release(id) { say(`Release post #${id} in ${POPUP}…`); await call("release", [id]); say(`Released post #${id}.`); },
  async cancel(id) { say(`Cancel post #${id} in ${POPUP}…`); await call("cancel", [id]); say(`Cancelled post #${id}; funds returned.`); },
  async punish(id, p) {
    const t = tokenOf(p.token)!, burn = amount(`amt-${id}`, t), cost = (burn * BigInt(p.ratio) + 9999n) / 10000n;
    if (burn > p.stake) throw new Error(`At most ${fmt(p.stake, t.decimals)} ${t.symbol}`);
    if (cost > 0n) await allow(t, cost);
    say(`Burn ${fmt(burn, t.decimals)} ${t.symbol} of the seller's stake, costing you ${fmt(cost, t.decimals)}, in ${POPUP}…`);
    await call("punish", [id, burn]);
    say(`Punished post #${id}.`);
  },
  async topUp(id, p) {
    const t = tokenOf(p.token)!, add = amount(`amt-${id}`, t);
    await allow(t, add);
    say(`Add ${fmt(add, t.decimals)} ${t.symbol} of stake in ${POPUP}…`);
    await call("topUp", [id, add]);
    say(`Stake added to post #${id}.`);
  },
  async reveal(id, p, file) {
    const f = await ciphertext(id, p, file), k = await getKeys();
    const { key, dataHash, cipherHash } = sellerOpen(k.seed, f.bytes, p.proofhash);
    say(`Publish the key for post #${id} in ${POPUP}…`);
    await call("reveal", [id, toHex(key), dataHash, cipherHash]);
    say(`Post #${id} is public: anyone with the ciphertext can decrypt it.`);
  },
};
const NEEDS_FILE = new Set(["deliver", "decrypt", "reveal"]);
const posts = new Map<bigint, Post>();

function postButtons(id: bigint, p: Post) {
  const me = account && getAddress(account), seller = me === getAddress(p.seller), buyer = me === getAddress(p.buyer), late = now() > p.deadline;
  const b: [string, string][] = [], amt = (label: string) => `<input id="amt-${id}" inputmode="decimal" placeholder="${label}" aria-label="${label}">`;
  let input = "";
  if (!tokenOf(p.token)) return "<p class=\"muted\">Token not listed in this app.</p>";
  if (p.status === 1 && !seller) b.push(["buy", "Buy"]);
  if ((p.status === 1 || p.status === 2) && seller) { b.push(["cancel", "Cancel"], ["topUp", "Add stake"]); input = amt("Stake to add"); }
  if (p.status === 2 && seller && !late) b.push(["deliver", "Deliver key…"]);
  if (p.status === 2 && buyer && late) b.push(["cancel", "Refund (not delivered)"]);
  if (p.status === 3 && buyer) b.push(["release", "Release"]);
  if (p.status === 3 && buyer && !late) { b.push(["punish", "Punish"]); input = amt("Stake to burn"); }
  if (p.status === 3 && !buyer && late) b.push(["release", "Release"]);
  if ((p.status === 4 || p.status === 5) && seller && p.revealedKey === "0x") b.push(["reveal", "Make public…"]);
  if ((buyer && p.status >= 3 && p.status <= 5) || p.revealedKey !== "0x") b.push(["decrypt", "Decrypt file…"]);
  if (!account) return "";
  return `${input}<div class="acts">${b.map(([a, l]) => `<button type="button" class="secondary" data-act="${a}" data-id="${id}">${l}</button>`).join("")}</div>`;
}

async function loadPosts() {
  const n: bigint = await read(mecenate, chain.mecenate!, "postCount");
  const ids = Array.from({ length: Number(n < 30n ? n : 30n) }, (_, i) => n - BigInt(i));
  const list: Post[] = await Promise.all(ids.map((id) => read(mecenate, chain.mecenate!, "getPost", [id])));
  const sellers = [...new Set(list.map((p) => p.seller))];
  const stats = new Map(await Promise.all(sellers.map(async (s) => [s, await read(mecenate, chain.mecenate!, "stats", [s])] as const)));
  posts.clear();
  $("posts").innerHTML = list.length ? "" : `<p class="muted">No posts yet.</p>`;
  list.forEach((p, i) => {
    const id = ids[i], t = tokenOf(p.token), d = t?.decimals ?? 18, sym = t?.symbol ?? short(p.token), [ok, bad] = stats.get(p.seller)!;
    posts.set(id, p);
    const deadline = p.status === 2 ? `deliver by ${when(p.deadline)}` : p.status === 3 ? `punish window ends ${when(p.deadline)}` : "";
    $("posts").insertAdjacentHTML("beforeend", `<article class="card post">
      <div class="line"><b>#${id}</b><span class="badge s${p.status}">${STATUS[p.status]}</span></div>
      <p class="uri">${esc(parseUri(p.uri).text) || "<span class=muted>no description</span>"}${freenetAddr(p) ? ` <span class="badge">on Freenet</span>` : ""}</p>
      <dl class="details">
        <div><dt>Price</dt><dd>${fmt(p.payment, d)} ${esc(sym)}</dd></div>
        <div><dt>Seller stake</dt><dd>${fmt(p.stake, d)} ${esc(sym)}</dd></div>
        <div><dt>Punish cost</dt><dd>${p.ratio / 100}% · window ${days(p.period)}</dd></div>
        <div><dt>Seller</dt><dd>${short(p.seller)} · ${ok} sold, ${bad} punished</dd></div>
        ${deadline ? `<div><dt>Deadline</dt><dd>${deadline}</dd></div>` : ""}
      </dl>
      ${postButtons(id, p)}
    </article>`);
  });
}

$("posts").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
  if (!btn || busy) return;
  const id = BigInt(btn.dataset.id!), act = btn.dataset.act!, p = posts.get(id)!;
  const file = NEEDS_FILE.has(act) && !freenetAddr(p) ? pickFile() : undefined; // before any await: the picker needs this click
  if (file) say("Choose the encrypted file (the ciphertext published for this post)…");
  void run(() => actions[act](id, p, file));
});

// ---- sell ----

$("sGo").addEventListener("click", () => void run(async () => {
  const f = $<HTMLInputElement>("sFile").files?.[0];
  if (!f) throw new Error("Choose a file first");
  if (!val("sUri")) throw new Error("Say what the file is");
  const t = pickedToken("sTok"), pay = amount("sPay", t), stake = amount("sStake", t), ratio = percentBps("sRatio"), period = seconds("sDays");
  if (cipher?.source !== f) { // a retry after a failed transaction reuses the upload
    const { seed } = await getKeys();
    const { file, proof } = encryptFile(seed, new Uint8Array(await f.arrayBuffer()));
    const addr = await toFreenet(file, (i, n) => say(`Publishing the encrypted file on Freenet… ${i}/${n}`));
    cipher = { source: f, proof, addr };
  }
  await allow(t, stake);
  say(`Create the post, staking ${fmt(stake, t.decimals)} ${t.symbol}, in ${POPUP}…`);
  await call("create", [t.address, stake, pay, ratio, period, cipher.proof, makeUri(cipher.addr, val("sUri"))]);
  cipher = undefined;
  $<HTMLInputElement>("sFile").value = "";
  say("Post created. It is on the Market tab.");
}));

// ---- bay ----

const reqs = new Map<bigint, Request>();
async function loadRequests() {
  const n: bigint = await read(mecenate, chain.mecenate!, "requestCount");
  const ids = Array.from({ length: Number(n < 50n ? n : 50n) }, (_, i) => n - BigInt(i));
  const list: Request[] = await Promise.all(ids.map((id) => read(mecenate, chain.mecenate!, "getRequest", [id])));
  reqs.clear();
  $("requests").innerHTML = "";
  list.forEach((r, i) => {
    const id = ids[i], t = tokenOf(r.token);
    if (r.buyer === "0x0000000000000000000000000000000000000000" || !t) return; // filled, withdrawn, or unlisted token
    reqs.set(id, r);
    const mine = account && getAddress(account) === getAddress(r.buyer);
    $("requests").insertAdjacentHTML("beforeend", `<article class="card post">
      <div class="line"><b>Request #${id}</b><span class="muted">${short(r.buyer)}</span></div>
      <p class="uri">${esc(r.description)}</p>
      <dl class="details">
        <div><dt>Reward</dt><dd>${fmt(r.payment, t.decimals)} ${t.symbol}</dd></div>
        <div><dt>Seller stake at least</dt><dd>${fmt(r.minStake, t.decimals)} ${t.symbol}</dd></div>
        <div><dt>Punish cost at most</dt><dd>${r.maxRatio / 100}% · window at least ${days(r.minPeriod)}</dd></div>
      </dl>
      ${!account ? "" : mine ? `<div class="acts"><button type="button" class="secondary" data-req="withdraw" data-id="${id}">Withdraw reward</button></div>`
        : `<input id="fill-${id}" inputmode="numeric" placeholder="Your open post # with matching terms" aria-label="Post number"><div class="acts"><button type="button" class="secondary" data-req="fill" data-id="${id}">Fill with post</button></div>`}
    </article>`);
  });
  if (!reqs.size) $("requests").innerHTML = `<p class="muted">No open requests.</p>`;
}

$("requests").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-req]");
  if (!btn || busy) return;
  const id = BigInt(btn.dataset.id!);
  void run(async () => {
    if (btn.dataset.req === "withdraw") { say(`Withdraw request #${id} in ${POPUP}…`); await call("cancelRequest", [id]); say("Reward returned."); return; }
    const post = BigInt(val(`fill-${id}`) || "0");
    if (!post) throw new Error("Enter the number of your open post");
    say(`Fill request #${id} with post #${post} in ${POPUP}…`);
    await call("fill", [id, post]);
    say(`Post #${post} is now sold to the requester: deliver the key from the Market tab.`);
  });
});

$("rGo").addEventListener("click", () => void run(async () => {
  if (!val("rDesc")) throw new Error("Describe what you are looking for");
  const t = pickedToken("rTok"), pay = amount("rPay", t), minStake = amount("rStake", t), ratio = percentBps("rRatio"), period = seconds("rDays");
  const { pub } = await getKeys();
  await allow(t, pay);
  say(`Escrow ${fmt(pay, t.decimals)} ${t.symbol} in ${POPUP}…`);
  await call("request", [t.address, pay, minStake, ratio, period, pub, val("rDesc")]);
  say("Request posted.");
}));

// ---- shell ----

let tab = "market";
function render() {
  $("chains").replaceChildren(...CHAINS.map((c) => Object.assign(document.createElement("button"), { type: "button", textContent: c.name, className: c === chain ? "on" : "", onclick: () => void pickChain(c) })));
  for (const id of ["sTok", "rTok"]) {
    const sel = $<HTMLSelectElement>(id), keep = sel.selectedIndex;
    sel.replaceChildren(...chain.tokens.map((t) => new Option(t.symbol)));
    sel.selectedIndex = Math.max(0, Math.min(keep, chain.tokens.length - 1));
  }
  const c = $<HTMLButtonElement>("connect");
  c.hidden = ready();
  c.disabled = busy;
  c.textContent = !account ? "Connect wallet" : `Switch to ${chain.name}`;
  for (const id of ["sGo", "rGo"]) $<HTMLButtonElement>(id).disabled = busy || !ready();
  document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  for (const id of ["market", "sell", "bay"]) $(id).hidden = id !== tab;
}

async function refresh() {
  render();
  if (!ready()) { $("posts").innerHTML = $("requests").innerHTML = `<p class="muted">Connect your wallet to read ${chain.name}.</p>`; return; }
  try { await (tab === "bay" ? loadRequests() : loadPosts()); } catch (e) { say((e as Error).message); }
}

async function pickChain(c: Chain) {
  if (busy || c === chain) return;
  chain = c; cipher = undefined; say("");
  if (account) await run(async () => { await ensureChain(); say(""); });
  else render();
}

async function run(task: () => Promise<void>) {
  busy = true; render();
  try { await task(); } catch (e) { say(String((e as { message?: string }).message ?? e)); }
  busy = false;
  await refresh();
}

document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) => b.addEventListener("click", () => { tab = b.dataset.tab!; void refresh(); }));
$("connect").addEventListener("click", () => void run(!account ? connect : ensureChain));
$("how").addEventListener("click", () => $<HTMLDialogElement>("howto").showModal());
void refresh();
