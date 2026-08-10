import { createMiddleware } from 'hono/factory';
import { userRepo } from '../container';
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
