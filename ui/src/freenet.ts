import { blake3 } from "@noble/hashes/blake3.js";
import {
  ContractContainer, ContractKey, ContractType, FreenetWsApi, GetRequest, PutRequest, WasmContractV1, type ResponseHandler,
} from "@freenetorg/freenet-stdlib";
import { ContractCodeT } from "@freenetorg/freenet-stdlib/common";
import { RelatedContractsT } from "@freenetorg/freenet-stdlib/client-request";
// FreeTunes' chunk contract (github.com/scobru/freetunes, chunk/): immutable state, parameters = blake3(content),
// so a chunk can be checked against its address. Same wasm, same addresses: chunks are shared with FreeTunes.
import chunkWasm from "./chunk.wasm?url";

// Ciphertexts live on Freenet as content-addressed chunks plus a manifest chunk listing them; a post's uri is
// "freenet:<manifest address> <description>". Integrity does not rest on Freenet: the buyer checks the proofhash.
// Connection and chunk handling follow FreeTunes' ui/src/lib.ts.

let apiP: Promise<FreenetWsApi> | undefined;
function api(): Promise<FreenetWsApi> {
  return (apiP ??= new Promise((resolve, reject) => {
    const url = import.meta.env.DEV
      ? `ws://${import.meta.env.VITE_NODE ?? "127.0.0.1:7509"}/v1/contract/command`
      : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/contract/command`; // the shell only proxies its own origin
    const h: ResponseHandler = {
      onContractPut() {}, onContractGet() {}, onContractUpdate() {}, onContractUpdateNotification() {}, onDelegateResponse() {},
      onContractNotFound: () => console.warn("contract not found"),
      onErr: (e) => console.error(e.cause),
      onOpen: () => resolve(a),
      onClose: () => { apiP = undefined; reject(new Error("Freenet node connection closed")); },
    };
    const a = new FreenetWsApi(new URL(url), h, "");
  }));
}

// The socket can drop right after the page opens (for example while the shell re-authenticates).
async function retrying<T>(f: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await f(); }
    catch (e) {
      if (i >= tries || !/closed/i.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

// get() responses are matched by arrival order: serialize them.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => { const p = queue.then(f); queue = p.catch(() => {}); return p; };
const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);

let code: Promise<{ code: Uint8Array; codeHash: Uint8Array }> | undefined;
const codeOf = () => (code ??= fetch(chunkWasm).then(async (r) => { const c = new Uint8Array(await r.arrayBuffer()); return { code: c, codeHash: blake3(c) }; }));
const keyOf = async (params: Uint8Array) => new ContractKey(blake3(new Uint8Array([...(await codeOf()).codeHash, ...params])), (await codeOf()).codeHash);

const getChunk = (addr: string) => serial(() => retrying(async () => {
  const r = await (await api()).get(new GetRequest(ContractKey.fromInstanceId(addr), false));
  return new Uint8Array(r.state); // the contract refuses any state that does not hash to its address
}));

/** Drop the socket: this clears requests the node will never answer. */
async function resetSocket() {
  ((await api()) as unknown as { ws?: { close(): void } }).ws?.close();
  await new Promise((r) => setTimeout(r, 300));
}

// Publishing a chunk the node already hosts is never answered, and the stale request would misalign the replies to
// later ones: a silent put is treated as "maybe already there", the socket is reset and a read decides.
const published = new Set<string>();
async function putChunk(content: Uint8Array): Promise<string> {
  const params = blake3(content), key = await keyOf(params), addr = key.encode();
  if (published.has(addr)) return addr;
  const { code: c, codeHash } = await codeOf();
  const contract = new WasmContractV1(new ContractCodeT(Array.from(c), Array.from(codeHash)), Array.from(params), key);
  const put = retrying(async () => (await api()).put(new PutRequest(new ContractContainer(ContractType.WasmContractV1, contract), Array.from(content), new RelatedContractsT())));
  try { await withTimeout(put, 8000); }
  catch (e) {
    put.catch(() => {});
    if (!/timeout/.test(String(e))) throw e;
    await resetSocket();
    try { await withTimeout(getChunk(addr), 8000); }
    catch { throw new Error("The Freenet node did not accept a chunk"); }
  }
  published.add(addr);
  return addr;
}

export const CHUNK = 512 * 1024;
type Manifest = { v: 1; size: number; chunks: string[] };

/** Publishes `file` and returns its manifest address. */
export async function upload(file: Uint8Array, progress: (done: number, total: number) => void): Promise<string> {
  const chunks: string[] = [], total = Math.ceil(file.length / CHUNK);
  for (let i = 0; i < total; i++) { chunks.push(await putChunk(file.subarray(i * CHUNK, (i + 1) * CHUNK))); progress(i + 1, total); }
  const manifest: Manifest = { v: 1, size: file.length, chunks };
  return putChunk(new TextEncoder().encode(JSON.stringify(manifest)));
}

export async function download(addr: string, progress: (done: number, total: number) => void): Promise<Uint8Array> {
  const m = JSON.parse(new TextDecoder().decode(await getChunk(addr))) as Manifest;
  if (m.v !== 1 || !Array.isArray(m.chunks)) throw new Error("Not a Mecenate file on Freenet");
  const out = new Uint8Array(m.size);
  let at = 0;
  for (const [i, c] of m.chunks.entries()) {
    const part = await getChunk(c);
    if (at + part.length > m.size) throw new Error("Freenet file is longer than its manifest says");
    out.set(part, at); at += part.length;
    progress(i + 1, m.chunks.length);
  }
  if (at !== m.size) throw new Error("Freenet file is shorter than its manifest says");
  return out;
}

/** Splits a post uri into its Freenet manifest address (if any) and the description. */
export function parseUri(uri: string): { addr?: string; text: string } {
  const m = /^freenet:([1-9A-HJ-NP-Za-km-z]{32,50})(?:\s+([\s\S]*))?$/.exec(uri.trim());
  return m ? { addr: m[1], text: m[2] ?? "" } : { text: uri };
}
export const makeUri = (addr: string, text: string) => `freenet:${addr} ${text.trim()}`;
