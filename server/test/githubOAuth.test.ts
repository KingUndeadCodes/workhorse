import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAuthorizeUrl, exchangeCodeForToken, getGitHubOAuthConfig, signState, verifyState } from '../src/services/githubOAuth';

const config = { clientId: 'cid', clientSecret: 'secret', callbackUrl: 'http://localhost:8787/api/git-connections/github/oauth/callback' };
const payload = { projectId: 'p1', userId: 'u1', owner: 'acme', repo: 'widgets', defaultBranch: 'main', returnTo: 'http://localhost:5173/' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('getGitHubOAuthConfig', () => {
  it('is undefined unless client id, secret and PUBLIC_URL are all set', () => {
    vi.stubEnv('GITHUB_OAUTH_CLIENT_ID', 'cid');
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', '');
    vi.stubEnv('PUBLIC_URL', 'http://localhost:8787');
    expect(getGitHubOAuthConfig()).toBeUndefined();
    vi.stubEnv('GITHUB_OAUTH_CLIENT_SECRET', 'secret');
    expect(getGitHubOAuthConfig()?.callbackUrl).toBe('http://localhost:8787/api/git-connections/github/oauth/callback');
  });
});

describe('OAuth state', () => {
  it('round-trips', () => {
    expect(verifyState(signState(payload))).toMatchObject(payload);
  });

  it('rejects a tampered payload', () => {
    const [, sig] = signState(payload).split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, userId: 'attacker', exp: Date.now() + 60_000 })).toString('base64url');
    expect(() => verifyState(`${forged}.${sig}`)).toThrow('Invalid OAuth state');
  });

  it('rejects garbage and expired state', () => {
    expect(() => verifyState('nope')).toThrow('Invalid OAuth state');
    vi.useFakeTimers();
    const state = signState(payload);
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(() => verifyState(state)).toThrow(/expired/);
  });
});

describe('authorize URL and code exchange', () => {
  it('builds an authorize URL with repo scope and the state', () => {
    const url = new URL(buildAuthorizeUrl(config, 'abc'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('scope')).toBe('repo');
    expect(url.searchParams.get('state')).toBe('abc');
    expect(url.searchParams.get('redirect_uri')).toBe(config.callbackUrl);
  });

  it('returns the access token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'gho_x' }), { status: 200 })));
    expect(await exchangeCodeForToken(config, 'code')).toBe('gho_x');
  });

  it("surfaces GitHub's error when no token comes back", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }), { status: 200 })));
    await expect(exchangeCodeForToken(config, 'code')).rejects.toThrow('The code passed is incorrect or expired.');
  });
});
