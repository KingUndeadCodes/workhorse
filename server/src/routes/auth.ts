import { Hono } from 'hono';
import type { AuthVariables } from '../auth/middleware';
import { hashPassword, verifyPassword } from '../auth/password';
import { signToken } from '../auth/jwt';
import { userRepo, workspaceRepo } from '../container';

/** Public: signup and login need no prior token. Mounted before requireAuth in app.ts. */
export const publicAuthRouter = new Hono();

/**
 * POST /api/auth/signup — open self-signup: anyone with an email can create an account.
 * The very first person to ever sign up owns the workspace; everyone after joins as a
 * plain member. No invite flow yet, so this is the only role decision made automatically.
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
  if (await userRepo.findByEmail(email)) return c.json({ error: 'an account with this email already exists' }, 409);

  const isFirstMember = !(await workspaceRepo.hasAnyMember());
  let user;
  try {
    // The unique index on users(email) is what actually enforces uniqueness — the findByEmail
    // check above is only a fast path, not a lock, so two concurrent signups for the same
    // email can both pass it; whichever loses the insert lands here.
    user = await userRepo.createHuman(email, displayName, hashPassword(password));
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) return c.json({ error: 'an account with this email already exists' }, 409);
    throw err;
  }
  await workspaceRepo.addMember((await workspaceRepo.getWorkspace()).id, user.id, isFirstMember ? 'owner' : 'member', user.createdAt);

  const token = await signToken(user);
  return c.json({ user, token }, 201);
});

/** POST /api/auth/login — email + password -> token. Same 401 message for "no such user" and "wrong password". */
publicAuthRouter.post('/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const user = await userRepo.findByEmail(email);
  const hash = user && (await userRepo.getCredentialHash(user.id));
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

/**
 * PATCH /api/auth/me — updates the caller's own display name, email, and/or avatar. Never
 * accepts a target user id — only the authenticated caller can edit their own profile.
 */
meRouter.patch('/auth/me', async (c) => {
  const body = await c.req.json<{ displayName?: string; email?: string; avatarUrl?: string | null }>();
  const changes: { displayName?: string; email?: string; avatarUrl?: string | null } = {};

  if (body.displayName !== undefined) {
    const displayName = body.displayName.trim();
    if (!displayName) return c.json({ error: 'displayName cannot be empty' }, 400);
    changes.displayName = displayName;
  }
  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (!email || !email.includes('@')) return c.json({ error: 'a valid email is required' }, 400);
    const existing = await userRepo.findByEmail(email);
    if (existing && existing.id !== c.get('user').id) return c.json({ error: 'an account with this email already exists' }, 409);
    changes.email = email;
  }
  if (body.avatarUrl !== undefined) {
    // A few MB of headroom for a resized-client-side photo, encoded as base64 (~33% larger
    // than the raw bytes) — generous for an avatar, small enough sql.js won't choke on it.
    if (body.avatarUrl !== null && body.avatarUrl.length > 4_000_000) return c.json({ error: 'image is too large' }, 400);
    changes.avatarUrl = body.avatarUrl;
  }

  const user = await userRepo.updateProfile(c.get('user').id, changes);
  return c.json({ user });
});
