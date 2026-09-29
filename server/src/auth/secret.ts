import { getOrCreatePersistedSecret } from '../secretStore';

/**
 * JWT signing secret. Uses JWT_SECRET if set (for a real deploy); otherwise generated once
 * and persisted next to state.db/events.db so a server restart doesn't invalidate every
 * issued token.
 */
export function getJwtSecret(): string {
  return getOrCreatePersistedSecret('JWT_SECRET', 'jwt.secret');
}
