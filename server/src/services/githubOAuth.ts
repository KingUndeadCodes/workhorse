/**
 * The server half of the GitHub OAuth App authorization-code flow (plans/GIT_OAUTH_PLAN.md §3).
 * Configured entirely by env vars — unset means the connect flow simply isn't offered and
 * pasting a token stays the only way to connect. `state` is a short-lived HMAC-signed blob (not a DB
 * row) naming the user the public callback should save the connection for.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
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

export function signState(payload: Omit<OAuthState, 'exp'>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + STATE_TTL_MS })).toString('base64url');
  return `${body}.${mac(body)}`;
}

/** Throws a user-safe message if the state is malformed, tampered with, or expired. */
export function verifyState(state: string): OAuthState {
  const [body, sig] = state.split('.');
  const expected = body ? mac(body) : '';
  if (!body || !sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error('Invalid OAuth state');
  }
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as OAuthState;
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) throw new Error('This connect attempt expired — start again');
  return payload;
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
