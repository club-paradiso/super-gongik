/**
 * Deterministic serialization and hashing for backup integrity checks.
 *
 * This is corruption detection only: anyone can recompute the digest after
 * editing a file, so it proves neither origin nor authorship, and nothing is
 * encrypted. It catches truncated downloads, broken copies and accidental
 * hand edits.
 */

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace,
 * `undefined` members dropped, numbers and strings serialized exactly as
 * `JSON.stringify` does. For the JSON subset backups use (finite numbers,
 * strings, booleans, null, arrays, plain objects) this matches RFC 8785
 * (JCS), so a native client can reproduce the digest.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("Non-finite numbers cannot be serialized.");
      }
      return JSON.stringify(value);
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "object":
      break;
    default:
      throw new TypeError(`Cannot serialize a ${typeof value} value.`);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (item === undefined ? "null" : canonicalJson(item)))
      .join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (value: number, bits: number) =>
  (value >>> bits) | (value << (32 - bits));

/**
 * SHA-256 of the UTF-8 encoding of `text`, as lowercase hex. Synchronous and
 * dependency-free so parsing stays pure on every platform (Web Crypto's
 * digest is async-only).
 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(bytes);
  buffer[bytes.length] = 0x80;
  const view = new DataView(buffer.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10);
      w[i] = w[i - 16]! + s0 + w[i - 7]! + s1;
    }
    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + K[i]! + w[i]!) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    hash[0] = hash[0]! + a;
    hash[1] = hash[1]! + b;
    hash[2] = hash[2]! + c;
    hash[3] = hash[3]! + d;
    hash[4] = hash[4]! + e;
    hash[5] = hash[5]! + f;
    hash[6] = hash[6]! + g;
    hash[7] = hash[7]! + h;
  }
  return Array.from(hash, (word) => word.toString(16).padStart(8, "0")).join(
    "",
  );
}
