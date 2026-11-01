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
// Re-checking your own password before a sensitive change (email, password) — per signed-in user, since the caller is already authenticated.
const passwordCheckByUser = createRateLimiter({ max: 5, windowMs: 15 * 60_000 });

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

/**
 * Asks a signed-in user to prove it's really them before a sensitive change, by re-entering their
 * password. Returns the response to send when they haven't (missing -> 400, wrong -> 403, too many
 * tries -> 429), or `undefined` when the password checks out.
 *
 * A wrong password is deliberately a 403, never a 401: the app treats any 401 as "your session
 * expired" and signs the user out, so a typo here would log them out.
 */
async function requireCurrentPassword(c: Context, userId: string, currentPassword: unknown) {
  if (typeof currentPassword !== 'string' || !currentPassword) return c.json({ error: 'your current password is required' }, 400);
  const attempt = passwordCheckByUser.hit(userId);
  if (!attempt.ok) return tooManyAttempts(c, attempt.retryAfterSeconds);
  const hash = await userRepo.getCredentialHash(userId);
  // Same cost whether or not a credential row exists, as login does.
  const valid = hash ? await verifyPassword(currentPassword, hash) : await burnPasswordCheck(currentPassword);
  if (!valid) return c.json({ error: 'current password is incorrect' }, 403);
  passwordCheckByUser.reset(userId);
  return undefined;
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
 * Changing the email additionally requires `currentPassword`: the email is the login identifier,
 * so a session left open somewhere shouldn't be enough to take the account over.
 */
meRouter.patch('/auth/me', async (c) => {
  const body = await c.req.json<{ displayName?: string; email?: string; avatarUrl?: string | null; currentPassword?: string }>();
  const changes: { displayName?: string; email?: string; avatarUrl?: string | null } = {};

  if (body.displayName !== undefined) {
    const displayName = body.displayName.trim();
    if (!displayName) return c.json({ error: 'displayName cannot be empty' }, 400);
    changes.displayName = displayName;
  }
  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    if (!email || !email.includes('@')) return c.json({ error: 'a valid email is required' }, 400);
    // Resending the address you already have (the form always does) isn't a change, so needs no password.
    if (email !== c.get('user').email) {
      // Before the duplicate lookup, so someone without the password can't probe which emails are taken.
      const denied = await requireCurrentPassword(c, c.get('user').id, body.currentPassword);
      if (denied) return denied;
      const existing = await userRepo.findByEmail(email);
      if (existing && existing.id !== c.get('user').id) return c.json({ error: 'an account with this email already exists' }, 409);
      changes.email = email;
    }
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

/**
 * POST /api/auth/password — changes the caller's own password. Needs the current one (see
 * {@link requireCurrentPassword}) and a new one of at least 8 characters, matching signup.
 * Other signed-in devices stay signed in: sessions are stateless JWTs that simply expire, with no
 * server-side list to revoke from.
 */
meRouter.post('/auth/password', async (c) => {
  const body = await c.req.json<{ currentPassword?: unknown; newPassword?: unknown }>().catch(() => null);
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (newPassword.length < 8) return c.json({ error: 'password must be at least 8 characters' }, 400);

  const userId = c.get('user').id;
  const denied = await requireCurrentPassword(c, userId, currentPassword);
  if (denied) return denied;
  if (newPassword === currentPassword) return c.json({ error: 'choose a password different from your current one' }, 400);

  await userRepo.setPasswordHash(userId, await hashPassword(newPassword));
  return c.json({ ok: true });
});
