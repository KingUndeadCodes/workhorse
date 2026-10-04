/**
 * The server half of the GitHub OAuth App authorization-code flow (plans/GIT_OAUTH_PLAN.md §3).
 * Configured entirely by env vars — unset means the connect flow simply isn't offered and
 * pasting a token stays the only way to connect. `state` is a short-lived HMAC-signed blob (not a DB
 * row) naming the user the public callback should save the connection for.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getOrCreatePersistedSecret } from '../secretStore';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const STATE_TTL_MS = 10 * 60 * 1000;

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export function getGitHubOAuthConfig(): GitHubOAuthConfig | undefined {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  const publicUrl = process.env.PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (!clientId || !clientSecret || !publicUrl) return undefined;
  return { clientId, clientSecret, callbackUrl: `${publicUrl}/api/git-connections/github/oauth/callback` };
}

export interface OAuthState {
  userId: string;
  /** Single-use id — see {@link consumeState}. */
  nonce: string;
  /** Where the browser goes after the callback — supplied by the same authenticated user who started the flow. */
  returnTo: string;
  exp: number;
}

let cachedKey: string | undefined;
function stateKey(): string {
  return (cachedKey ??= getOrCreatePersistedSecret('OAUTH_STATE_SECRET', 'oauth-state.key'));
}

function mac(body: string): string {
  return createHmac('sha256', stateKey()).update(body).digest('base64url');
}

export function signState(payload: Omit<OAuthState, 'exp' | 'nonce'>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, nonce: randomUUID(), exp: Date.now() + STATE_TTL_MS })).toString('base64url');
  return `${body}.${mac(body)}`;
}

/** Throws a user-safe message if the state is malformed, tampered with, or expired. */
export function verifyState(state: string): OAuthState {
  const [body, sig] = state.split('.');
  // Compare bytes, not string length: a multi-byte `sig` can match in characters yet differ in
  // bytes, and timingSafeEqual throws on unequal byte lengths.
  const given = Buffer.from(sig ?? '');
  const expected = Buffer.from(body ? mac(body) : '');
  if (!body || !sig || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new Error('Invalid OAuth state');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) throw new Error('This connect attempt expired — start again');
  return payload;
}

/** Drops every entry of a `key -> expiry` map that has expired. */
function sweep(map: Map<string, { exp: number }>): void {
  const now = Date.now();
  for (const [key, value] of map) if (value.exp < now) map.delete(key);
}

const usedNonces = new Map<string, { exp: number }>();

/** Marks a verified state as used. Returns false if it was already used, so a state can't be replayed within its 10-minute lifetime. In-memory: a restart forgets it, but also invalidates nothing else — the state still expires on its own. */
export function consumeState(state: OAuthState): boolean {
  sweep(usedNonces);
  if (usedNonces.has(state.nonce)) return false;
  usedNonces.set(state.nonce, { exp: state.exp });
  return true;
}

const TICKET_TTL_MS = 60_000;
const pendingTickets = new Map<string, { userId: string; accessToken: string; exp: number }>();

/**
 * The public callback can't know *who is actually at the keyboard* — only whoever started the
 * flow is named in `state`, and a victim can be tricked into finishing an attacker's flow. So the
 * callback never saves anything: it parks the token under a one-time ticket, and the signed-in app
 * redeems it with its own bearer token (see {@link redeemConnectTicket}).
 */
export function issueConnectTicket(userId: string, accessToken: string): string {
  sweep(pendingTickets);
  const ticket = randomUUID();
  pendingTickets.set(ticket, { userId, accessToken, exp: Date.now() + TICKET_TTL_MS });
  return ticket;
}

/** Returns the parked token only if the ticket is live and was issued for `userId` — the signed-in caller. Single-use: the ticket is burned even when the user doesn't match. */
export function redeemConnectTicket(ticket: string, userId: string): string | undefined {
  sweep(pendingTickets);
  const pending = pendingTickets.get(ticket);
  pendingTickets.delete(ticket);
  return pending && pending.userId === userId ? pending.accessToken : undefined;
}

/**
 * Where the browser may be sent after the callback: the app's own origin(s), never a
 * client-chosen one. `APP_URL` is the origin the SPA is served from; it defaults to `PUBLIC_URL`'s,
 * which is right whenever the app and API share an origin. A split dev setup (Vite on :5173, API
 * on :8787) needs `APP_URL` set — `dev.sh` does that.
 */
export function isAllowedReturnTo(url: URL): boolean {
  return [process.env.APP_URL, process.env.PUBLIC_URL].some((raw) => {
    try {
      return !!raw && new URL(raw).origin === url.origin;
    } catch {
      return false;
    }
  });
}

export function buildAuthorizeUrl(config: GitHubOAuthConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.callbackUrl);
  url.searchParams.set('scope', 'repo');
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeCodeForToken(config: GitHubOAuthConfig, code: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.callbackUrl }),
  });
  if (!res.ok) throw new Error(`GitHub token exchange failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!data.access_token) throw new Error(data.error_description || data.error || 'GitHub did not return an access token');
  return data.access_token;
}
