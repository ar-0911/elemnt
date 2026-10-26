import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/** OWASP-recommended scrypt cost: N=2^17, r=8, p=1. Stored as `scrypt$N$r$p$salt$hash`. */
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 32;
const maxmem = 256 * N * R;

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(plain.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem });
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(plain.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 256 * Number(n) * Number(r) });
  return timingSafeEqual(actual, expected);
}

/** A hash to compare against when the account doesn't exist, so a wrong username takes as long as a wrong password. */
export const DUMMY_HASH = "scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
