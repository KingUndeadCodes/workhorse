import { Hono } from 'hono';
import type { AuthVariables } from '../auth/middleware';
import { hashPassword, verifyPassword } from '../auth/password';
import { signToken } from '../auth/jwt';
import { createUserWithCredentials, findUserByEmail, getCredentialHash } from '../auth/repository';
import { persistState } from '../db/core';

/** Public: signup and login need no prior token. Mounted before requireAuth in app.ts. */
export const publicAuthRouter = new Hono();

/**
 * POST /api/auth/signup — open self-signup: anyone with an email can create an account.
 *
 * NOTE FOR LATER (do not build now): restrict this to pre-invited emails once the app has
 * real users to invite — add an `invites` table (email, invited_at, invited_by) and check
 * `email` against it here before allowing account creation, returning 403 if absent.
 */
publicAuthRouter.post('/auth/signup', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string; displayName?: string }>();
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const displayName = (body.displayName ?? '').trim();
  if (!email || !email.includes('@')) return c.json({ error: 'a valid email is required' }, 400);
  if (password.length < 8) return c.json({ error: 'password must be at least 8 characters' }, 400);
  if (!displayName) return c.json({ error: 'displayName is required' }, 400);
  if (findUserByEmail(email)) return c.json({ error: 'an account with this email already exists' }, 409);

  const user = await createUserWithCredentials(email, displayName, hashPassword(password));
  persistState();
  const token = await signToken(user);
  return c.json({ user, token }, 201);
});

/** POST /api/auth/login — email + password -> token. Same 401 message for "no such user" and "wrong password". */
publicAuthRouter.post('/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const user = findUserByEmail(email);
  const hash = user && getCredentialHash(user.id);
  if (!user || !hash || !verifyPassword(password, hash)) {
    return c.json({ error: 'invalid email or password' }, 401);
  }
  const token = await signToken(user);
  return c.json({ user, token }, 200);
});

/** Protected: requires requireAuth to have already run (see app.ts mount order). */
export const meRouter = new Hono<{ Variables: AuthVariables }>();

/** GET /api/auth/me — returns the authenticated user. */
meRouter.get('/auth/me', (c) => c.json({ user: c.get('user') }));
