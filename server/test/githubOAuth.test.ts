import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAuthorizeUrl, consumeState, exchangeCodeForToken, getGitHubOAuthConfig, isAllowedReturnTo, issueConnectTicket, redeemConnectTicket, signState, verifyState,
} from '../src/services/githubOAuth';

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

describe('OAuth state hardening', () => {
  it('rejects a multi-byte signature with "Invalid OAuth state", not a RangeError from timingSafeEqual', () => {
    const body = signState(payload).split('.')[0];
    const forged = '✓'.repeat(43); // same character count as a real signature, different byte length
    expect(() => verifyState(`${body}.${forged}`)).toThrow('Invalid OAuth state');
  });

  it('gives every state its own nonce, and lets it be consumed only once', () => {
    const a = verifyState(signState(payload));
    const b = verifyState(signState(payload));
    expect(a.nonce).not.toBe(b.nonce);

    expect(consumeState(a)).toBe(true);
    expect(consumeState(a)).toBe(false); // replay
    expect(consumeState(b)).toBe(true);
  });
});

describe('connect tickets (the callback parks the token; only the signed-in user it was issued for can redeem it)', () => {
  it('releases the token to the user it was issued for, once', () => {
    const ticket = issueConnectTicket('u_victim', 'gho_victim');
    expect(redeemConnectTicket(ticket, 'u_victim')).toBe('gho_victim');
    expect(redeemConnectTicket(ticket, 'u_victim')).toBeUndefined();
  });

  it('refuses anyone else, and burns the ticket so it cannot be retried', () => {
    const ticket = issueConnectTicket('u_attacker', 'gho_victim');
    expect(redeemConnectTicket(ticket, 'u_victim')).toBeUndefined();
    expect(redeemConnectTicket(ticket, 'u_attacker')).toBeUndefined();
  });

  it('refuses an unknown or expired ticket', () => {
    expect(redeemConnectTicket('no-such-ticket', 'u1')).toBeUndefined();
    vi.useFakeTimers();
    const ticket = issueConnectTicket('u1', 'gho_x');
    vi.advanceTimersByTime(61_000);
    expect(redeemConnectTicket(ticket, 'u1')).toBeUndefined();
  });
});

describe('isAllowedReturnTo', () => {
  it('allows only the app\'s own origins (APP_URL, PUBLIC_URL) — never a client-chosen one', () => {
    vi.stubEnv('PUBLIC_URL', 'http://localhost:8787');
    vi.stubEnv('APP_URL', 'http://localhost:5173');
    expect(isAllowedReturnTo(new URL('http://localhost:5173/settings?x=1'))).toBe(true);
    expect(isAllowedReturnTo(new URL('http://localhost:8787/'))).toBe(true);
    expect(isAllowedReturnTo(new URL('https://evil.example/'))).toBe(false);
    expect(isAllowedReturnTo(new URL('http://localhost:5174/'))).toBe(false);
    expect(isAllowedReturnTo(new URL('https://localhost:5173/'))).toBe(false);
  });

  it('with no APP_URL, defaults to PUBLIC_URL\'s origin; with neither, allows nothing', () => {
    vi.stubEnv('APP_URL', '');
    vi.stubEnv('PUBLIC_URL', 'https://work.example.com');
    expect(isAllowedReturnTo(new URL('https://work.example.com/x'))).toBe(true);
    vi.stubEnv('PUBLIC_URL', '');
    expect(isAllowedReturnTo(new URL('https://work.example.com/x'))).toBe(false);
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
