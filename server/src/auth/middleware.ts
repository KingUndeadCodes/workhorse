import { createMiddleware } from 'hono/factory';
import { userRepo, workspaceRepo } from '../container';
import { verifyToken } from './jwt';

/** Hono context variable populated by {@link requireAuth} — read via `c.get('user')`. */
export type AuthVariables = { user: import('../domain').User };

/** Verifies the `Authorization: Bearer <token>` header and attaches the user to context; 401 on any failure. */
export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  try {
    const claims = await verifyToken(token);
    // Independent lookups, so run together rather than one after another.
    const [user, member, passwordChangedAt] = await Promise.all([
      userRepo.getById(claims.sub),
      workspaceRepo.getMember(claims.sub),
      userRepo.getPasswordChangedAt(claims.sub),
    ]);
    // A valid token alone isn't access: someone an admin has removed keeps a cryptographically valid
    // token for days, so membership is checked on every request, not only at login.
    if (!user || !member) return c.json({ error: 'unauthorized' }, 401);
    // Changing a password is how someone locks out a stolen session, so a token issued before the last change
    // is dead. (Whole-second granularity: one issued in the same second as the change still passes.)
    if ((claims.iat ?? 0) < passwordChangedAt) return c.json({ error: 'unauthorized' }, 401);
    c.set('user', user);
    await next();
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
});

/**
 * Shared guard for configuration that acts workspace-wide against every matching future event
 * (automation rules, webhooks, git repo links) — guests (read-mostly by convention, see
 * WorkspaceRole) may not define them. Returns an error message to 403 with, or `undefined` if
 * the caller may proceed.
 */
export async function requireNonGuest(c: { get: (k: 'user') => { id: string } }, action: string): Promise<string | undefined> {
  const caller = await workspaceRepo.getMember(c.get('user').id);
  if (!caller || caller.role === 'guest') return `Guests cannot ${action}`;
  return undefined;
}
