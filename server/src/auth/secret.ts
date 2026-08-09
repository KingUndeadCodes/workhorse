import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
const SECRET_PATH = join(DATA_DIR, 'jwt.secret');

/**
 * JWT signing secret. Uses JWT_SECRET if set (for a real deploy); otherwise generated once
 * and persisted next to state.db/events.db so a server restart doesn't invalidate every
 * issued token.
 */
export function getJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(SECRET_PATH)) return readFileSync(SECRET_PATH, 'utf8').trim();
  const secret = randomBytes(48).toString('hex');
  writeFileSync(SECRET_PATH, secret, 'utf8');
  return secret;
}
