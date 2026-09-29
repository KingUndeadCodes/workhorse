/**
 * A secret sourced from an env var if set (for a real deploy), otherwise generated once and
 * persisted to a file next to state.db/events.db so a restart doesn't invalidate whatever was
 * derived from it. Shared by `auth/secret.ts`'s JWT secret and `crypto/tokenCipher.ts`'s
 * encryption key — same shape, different env var/file per caller.
 *
 * Generation is atomic (`wx`: fail if the file already exists) rather than a plain
 * existsSync-then-writeFileSync check: two processes (or, in this repo's own test suite, two
 * parallel Vitest worker threads) racing to create the file for the first time would otherwise
 * each pick a different random secret and each write it, silently leaving whichever wrote last
 * as "the" secret — anything already derived from the loser's value (e.g. a token encrypted
 * with it) becomes permanently unrecoverable. With `wx`, the loser's write fails with `EEXIST`
 * and it re-reads the winner's file instead of clobbering it.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');

export function getOrCreatePersistedSecret(envVar: string, fileName: string): string {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;

  const path = join(DATA_DIR, fileName);
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();

  const secret = randomBytes(48).toString('hex');
  try {
    writeFileSync(path, secret, { encoding: 'utf8', flag: 'wx' });
    return secret;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return readFileSync(path, 'utf8').trim();
    throw err;
  }
}
