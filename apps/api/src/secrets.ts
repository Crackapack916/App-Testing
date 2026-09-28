import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** Password hashing with scrypt (node built in). Stored as scrypt$N$r$p$salt$hash, base64. */
const N = 16384, R = 8, P = 1, KEYLEN = 32;

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null) {
  const parts = stored?.split("$");
  if (!parts || parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, hash] = parts;
  const key = await scryptAsync(password, Buffer.from(salt, "base64"), Number(n), Number(r), Number(p));
  const expected = Buffer.from(hash, "base64");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Birthdates are encrypted at rest with AES-256-GCM. The key comes from DOB_ENCRYPTION_KEY (32 bytes, base64). */
export function encryptDob(isoDate: string, key: Buffer) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(isoDate, "utf8"), c.final()]);
  return `v1.${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${body.toString("base64")}`;
}

export function decryptDob(stored: string, key: Buffer) {
  const [v, iv, tag, body] = stored.split(".");
  if (v !== "v1") throw new Error("unknown_dob_format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

export function dobKeyFrom(value: string | undefined) {
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("DOB_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return key;
}

/** Reset links carry a random token; only its hash is stored. */
export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A real calendar date from three fields, or null. */
export function realDate(month: unknown, day: unknown, year: unknown) {
  const m = Number(month), d = Number(day), y = Number(year);
  if (![m, d, y].every(Number.isInteger) || y < 1900 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
