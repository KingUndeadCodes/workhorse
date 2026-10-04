/**
 * Encrypts small secrets at rest — a person's git credential (`UserGitConnection`'s personal access
 * token or OAuth access token) and `WebhookSubscription.secret` (used to HMAC-sign outbound deliveries) — so a stolen copy of
 * `state.db` alone doesn't hand over live write access to every linked repo or the ability to
 * forge signed webhook deliveries. AES-256-GCM with a random IV per call — GCM's auth tag also
 * means a corrupted/tampered ciphertext fails to decrypt loudly instead of silently returning
 * garbage.
 *
 * Key handling shares `secretStore.ts`'s `getOrCreatePersistedSecret` with `auth/secret.ts`'s
 * `getJwtSecret()`: `TOKEN_ENCRYPTION_KEY` if set (for a real deploy), otherwise generated once
 * and persisted next to state.db/events.db so a restart doesn't strand every already-encrypted
 * token. Kept as its own secret, not reused from `JWT_SECRET` — rotating auth shouldn't force
 * re-linking every repo, and vice versa.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getOrCreatePersistedSecret } from '../secretStore';

/** Marks a value as this module's ciphertext — anything else (including a pre-encryption plaintext token already sitting in an existing database) is passed through unchanged by {@link decryptToken}, so turning this on never breaks an existing git link. */
const PREFIX = 'gcm1:';

/** AES-256-GCM needs exactly 32 key bytes — hashing the (arbitrary-length) secret gets there regardless of how `TOKEN_ENCRYPTION_KEY` was generated. Cached after first use: the secret can't change without a restart, so there's no reason to re-read the key file/re-hash on every encrypt/decrypt call. */
let cachedKey: Buffer | undefined;
function deriveKey(): Buffer {
  if (!cachedKey) cachedKey = createHash('sha256').update(getOrCreatePersistedSecret('TOKEN_ENCRYPTION_KEY', 'token-encryption.key')).digest();
  return cachedKey;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptToken(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored; // pre-encryption row — see PREFIX's doc comment
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
