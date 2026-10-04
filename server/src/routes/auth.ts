import { getConnInfo } from '@hono/node-server/conninfo';
import { Hono, type Context } from 'hono';
import type { AuthVariables } from '../auth/middleware';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../auth/password';
import { createRateLimiter } from '../auth/rateLimit';
import { signToken } from '../auth/jwt';
import { userRepo, workspaceRepo } from '../container';
import { issueWsTicket } from '../ws';

// Per email AND per client address, so one attacker can neither hammer one account nor spray many.
const loginByEmail = createRateLimiter({ max: 10, windowMs: 15 * 60_000 });
const loginByClient = createRateLimiter({ max: 30, windowMs: 15 * 60_000 });
const signupByClient = createRateLimiter({ max: 10, windowMs: 60 * 60_000 });

/** The caller's address. Only trusts X-Forwarded-For when the deployment says it sits behind a proxy (TRUST_PROXY=1) — otherwise the header is attacker-controlled and would let anyone dodge the limit. */
function clientKey(c: Context): string {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // no socket (e.g. in-process test requests)
  }
}

function tooManyAttempts(c: Context, retryAfterSeconds: number) {
  c.header('Retry-After', String(retryAfterSeconds));
  return c.json({ error: 'too many attempts — try again later' }, 429);
}

/** Public: signup and login need no prior token. Mounted before requireAuth in app.ts. */
export const publicAuthRouter = new Hono();

/**
 * POST /api/auth/signup — open self-signup: anyone with an email can create an account.
 * The very first person to ever sign up owns the workspace. Everyone after joins with
 * whatever role a pending `WorkspaceInvite` (routes/workspace.ts) grants their email, or
 * a plain member if no invite is pending — invites are a pre-approval allowlist only,
 * never an access gate: signup itself stays open to anyone.
 */
publicAuthRouter.post('/auth/signup', async (c) => {
  const limited = signupByClient.hit(clientKey(c));
  if (!limited.ok) return tooManyAttempts(c, limited.retryAfterSeconds);
  const body = await c.req.json<{ email?: string; password?: string; displayName?: string }>();
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const displayName = (body.displayName ?? '').trim();
  if (!email || !email.includes('@')) return c.json({ error: 'a valid email is required' }, 400);
  if (password.length < 8) return c.json({ error: 'password must be at least 8 characters' }, 400);
  if (!displayName) return c.json({ error: 'displayName is required' }, 400);
  if (await userRepo.findByEmail(email)) return c.json({ error: 'an account with this email already exists' }, 409);

  const isFirstMember = !(await workspaceRepo.hasAnyMember());
  const invite = isFirstMember ? undefined : await workspaceRepo.getInviteByEmail(email);
  let user;
  try {
    // The unique index on users(email) is what actually enforces uniqueness — the findByEmail
    // check above is only a fast path, not a lock, so two concurrent signups for the same
    // email can both pass it; whichever loses the insert lands here.
    user = await userRepo.createHuman(email, displayName, await hashPassword(password));
  } catch (err) {
    if (err instanceof Error && /unique/i.test(err.message)) return c.json({ error: 'an account with this email already exists' }, 409);
    throw err;
  }
  await workspaceRepo.addMember((await workspaceRepo.getWorkspace()).id, user.id, isFirstMember ? 'owner' : (invite?.role ?? 'member'), user.createdAt);
  if (invite) await workspaceRepo.deleteInviteByEmail(email);

  const token = await signToken(user);
  return c.json({ user, token }, 201);
});

/** POST /api/auth/login — email + password -> token. Same 401 message for "no such user" and "wrong password". */
publicAuthRouter.post('/auth/login', async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  const byClient = loginByClient.hit(clientKey(c));
  const byEmail = loginByEmail.hit(email);
  if (!byClient.ok) return tooManyAttempts(c, byClient.retryAfterSeconds);
  if (!byEmail.ok) return tooManyAttempts(c, byEmail.retryAfterSeconds);

  const user = await userRepo.findByEmail(email);
  const hash = user && (await userRepo.getCredentialHash(user.id));
  // Both branches pay for one scrypt derivation, so timing doesn't reveal which emails have accounts.
  const valid = user && hash ? await verifyPassword(password, hash) : await burnPasswordCheck(password);
  if (!user || !valid) {
    return c.json({ error: 'invalid email or password' }, 401);
  }
  loginByEmail.reset(email);
  if (!(await workspaceRepo.getMember(user.id))) return c.json({ error: 'you are no longer a member of this workspace' }, 403);
  const token = await signToken(user);
  return c.json({ user, token }, 200);
});

/** Protected: requires requireAuth to have already run (see app.ts mount order). */
export const meRouter = new Hono<{ Variables: AuthVariables }>();

/** POST /api/ws-ticket -> `{ ticket }` — a one-time, 30-second pass to open the live-update websocket as the caller (see ws.ts's issueWsTicket for why the JWT itself isn't put in the URL). */
meRouter.post('/ws-ticket', (c) => c.json({ ticket: issueWsTicket(c.get('user').id) }));

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
