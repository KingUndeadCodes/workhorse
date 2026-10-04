import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

// Async on purpose: scryptSync blocks the event loop for the whole derivation, so a handful of parallel
// login attempts would stall every other request on the server.
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: { N: number }) => Promise<Buffer>;

const KEY_LEN = 64;
const N = 16384; // scrypt cost param (2^14) — fine for an interactive login on a small app
const SALT_LEN = 16;
/**
 * The only cost parameters a stored hash may name. The hash string is self-describing (see below), so a
 * tampered row could otherwise ask for an enormous N and hang the login — or exhaust memory — on demand.
 * When the cost is raised, add the new N here *and* keep the old one so existing hashes still verify.
 */
const ALLOWED_N: ReadonlySet<number> = new Set([N]);

/** Format: scrypt$<N>$<saltHex>$<hashHex> — self-describing so params can change later without a blind migration. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const hash = await scryptAsync(password, salt, KEY_LEN, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4) return false; // exactly scheme$N$salt$hash — anything else is malformed, not "close enough"
  const [scheme, nStr, saltHex, hashHex] = parts;
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const n = Number(nStr);
  if (!ALLOWED_N.has(n)) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_LEN) return false;
  const actual = await scryptAsync(password, salt, expected.length, { N: n });
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;
/**
 * A real hash of a throwaway password, for logins that name an email with no account: running the same
 * derivation anyway makes "no such user" take as long as "wrong password", so response time can't be used
 * to find out which emails have accounts.
 */
export function burnPasswordCheck(password: string): Promise<boolean> {
  dummyHash ??= hashPassword('workhorse-timing-equalizer');
  return dummyHash.then((hash) => verifyPassword(password, hash)).then(() => false);
}
