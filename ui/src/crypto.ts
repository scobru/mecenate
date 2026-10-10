import { gcm } from "@noble/ciphers/aes.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, concat, hexToBytes, keccak256, sha256, stringToBytes, type Hex } from "viem";

// Everything is derived from one wallet signature of KEY_MESSAGE: the sandbox has no storage to keep keys in.
// Ciphertext file: salt(16) | nonce(12) | AES-256-GCM(data). Its key is sha256(seed | salt), so the seller
// re-derives it from the published file instead of saving a key file.
// Sealed key: ephemeralPub(32) | nonce(12) | AES-256-GCM(key) under sha256(x25519(ephemeral, buyerPub)).

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const h = (b: Uint8Array) => hexToBytes(sha256(b));

export type Keys = { seed: Uint8Array; priv: Uint8Array; pub: Hex };
export function keysFrom(signature: Hex): Keys {
  const secret = h(hexToBytes(signature));
  const priv = h(concat([stringToBytes("x25519"), secret]));
  return { seed: h(concat([stringToBytes("data"), secret])), priv, pub: bytesToHex(x25519.getPublicKey(priv)) };
}

export const proofhash = (dataHash: Hex, key: Uint8Array, cipherHash: Hex) => keccak256(concat([dataHash, sha256(key), cipherHash]));
const fileKey = (seed: Uint8Array, file: Uint8Array) => h(concat([seed, file.subarray(0, 16)]));

export function encryptFile(seed: Uint8Array, data: Uint8Array) {
  const salt = random(16), nonce = random(12);
  const file = concat([salt, nonce, gcm(h(concat([seed, salt])), nonce).encrypt(data)]);
  return { file, proof: proofhash(sha256(data), fileKey(seed, file), sha256(file)) };
}

/** Decrypts a ciphertext file and checks it against the post's proofhash; throws on any mismatch. */
export function openFile(key: Uint8Array, file: Uint8Array, proof: Hex) {
  if (file.length < 28 + 16) throw new Error("Not a Mecenate ciphertext file");
  let data: Uint8Array;
  try { data = gcm(key, file.subarray(16, 28)).decrypt(file.subarray(28)); }
  catch { throw new Error("This key does not open this file"); }
  const dataHash = sha256(data), cipherHash = sha256(file);
  if (proofhash(dataHash, key, cipherHash) !== proof) throw new Error("File or key does not match the post's proofhash");
  return { data, dataHash, cipherHash };
}

/** The seller's key for a file they encrypted, checked against the post. */
export function sellerOpen(seed: Uint8Array, file: Uint8Array, proof: Hex) {
  const key = fileKey(seed, file);
  return { key, ...openFile(key, file, proof) };
}

export function seal(key: Uint8Array, buyerPub: Hex): Hex {
  const eph = random(32), nonce = random(12);
  const shared = h(x25519.getSharedSecret(eph, hexToBytes(buyerPub)));
  return bytesToHex(concat([x25519.getPublicKey(eph), nonce, gcm(shared, nonce).encrypt(key)]));
}

export function unseal(sealed: Hex, priv: Uint8Array): Uint8Array {
  const b = hexToBytes(sealed);
  const shared = h(x25519.getSharedSecret(priv, b.subarray(0, 32)));
  try { return gcm(shared, b.subarray(32, 44)).decrypt(b.subarray(44)); }
  catch { throw new Error("This delivery was not encrypted to your key"); }
}
