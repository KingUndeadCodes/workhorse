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
    const user = await userRepo.getById(claims.sub);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
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
