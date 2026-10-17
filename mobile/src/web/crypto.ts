// Browser side of the encrypted session (spec: crates/remote-proto/src/web.rs). Pages served over
// plain http can't use the browser's WebCrypto, so this uses the audited @noble libraries:
// HKDF-SHA256 for the keys, ChaCha20-Poly1305 for the frames.
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

function seqBytes(seq: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, seq);
  return b;
}

function nonceFor(seq: bigint): Uint8Array {
  const n = new Uint8Array(12);
  n.set(seqBytes(seq), 4);
  return n;
}

/** One direction: a key and its frame counter. */
export class Half {
  private seq = 0n;
  private key: Uint8Array;
  constructor(key: Uint8Array) {
    this.key = key;
  }

  seal(plaintext: Uint8Array): Uint8Array {
    const s = seqBytes(this.seq);
    const ct = chacha20poly1305(this.key, nonceFor(this.seq), s).encrypt(plaintext);
    this.seq++;
    const out = new Uint8Array(8 + ct.length);
    out.set(s);
    out.set(ct, 8);
    return out;
  }

  /** null if out of order, replayed, tampered or under another key. */
  open(frame: Uint8Array): Uint8Array | null {
    if (frame.length < 24) return null;
    const seq = new DataView(frame.buffer, frame.byteOffset, 8).getBigUint64(0);
    if (seq !== this.seq) return null;
    try {
      const plain = chacha20poly1305(this.key, nonceFor(seq), frame.subarray(0, 8)).decrypt(frame.subarray(8));
      this.seq++;
      return plain;
    } catch {
      return null;
    }
  }
}

export type Mode = "pair" | "device";

/** The browser's keys: `send` = browser → computer, `recv` = computer → browser. */
export function browserKeys(secret: Uint8Array, clientNonce: Uint8Array, hostNonce: Uint8Array, mode: Mode) {
  const salt = new Uint8Array(clientNonce.length + hostNonce.length);
  salt.set(clientNonce);
  salt.set(hostNonce, clientNonce.length);
  const k = (dir: string) => hkdf(sha256, secret, salt, enc.encode(`devcat-web/1 ${mode} ${dir}`), 32);
  return { send: new Half(k("c2h")), recv: new Half(k("h2c")) };
}

/** Same frame as the Rust known-answer test (crates/remote-proto/src/web.rs). */
export const KNOWN_FRAME = "AAAAAAAAAABO6TjSdXFSiXF7k2BZrBtoGllhdWPwQkElkhpx";
export function knownFrame(): string {
  const k = browserKeys(new Uint8Array(32).fill(7), new Uint8Array(16).fill(1), new Uint8Array(16).fill(2), "pair");
  return b64url(k.send.seal(enc.encode('{"t":"ping"}')));
}
