import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../src/lib/api';
import { authToken, currentUser } from '../src/lib/stores/auth';

const ok = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status });
let fetchMock: ReturnType<typeof vi.fn>;
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(init.body as string) : undefined };
};

beforeEach(() => {
  fetchMock = vi.fn(async () => ok());
  vi.stubGlobal('fetch', fetchMock);
  authToken.set(null);
  currentUser.set(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('transport', () => {
  it('sends the bearer token only when logged in', async () => {
    await api.listGitProviders();
    expect(lastCall().headers.authorization).toBeUndefined();

    authToken.set('tok_123');
    await api.listGitProviders();
    expect(lastCall().headers.authorization).toBe('Bearer tok_123');
  });

  it('serializes an undefined field as null, so "clear this field" actually reaches the server (JSON.stringify would drop it)', async () => {
    await api.updateProject('p1', { leadId: undefined, name: 'Renamed' });
    expect(lastCall()).toMatchObject({ url: '/api/projects/p1', method: 'PATCH', body: { leadId: null, name: 'Renamed' } });
  });

  it('surfaces the server\'s { error } message instead of a bare status code', async () => {
    fetchMock.mockResolvedValueOnce(ok({ error: 'Project key "PRJ" is already in use' }, 409));
    await expect(api.createProject({ name: 'P', key: 'PRJ' })).rejects.toThrow('Project key "PRJ" is already in use');
  });

  it('falls back to "status statusText" when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }));
    await expect(api.listGitProviders()).rejects.toThrow('502 Bad Gateway');
  });

  it('on a 401, clears the stored login and throws AuthError', async () => {
    authToken.set('expired');
    currentUser.set({ id: 'u1' } as never);
    fetchMock.mockResolvedValueOnce(ok({}, 401));

    await expect(api.listGitProviders()).rejects.toBeInstanceOf(api.AuthError);

    expect(get(authToken)).toBeNull();
    expect(get(currentUser)).toBeNull();
  });
});

describe('git client', () => {
  it('links a repo with no credential in the body (the server uses the caller\'s own connection)', async () => {
    await api.linkGitRepo('p1', { provider: 'github', owner: 'acme', repo: 'widgets', defaultBranch: 'main' });
    expect(lastCall()).toMatchObject({ url: '/api/projects/p1/git-repo-link', method: 'POST', body: { provider: 'github', owner: 'acme', repo: 'widgets', defaultBranch: 'main' } });
    expect(lastCall().body).not.toHaveProperty('token');
  });

  it('manages the caller\'s own connections', async () => {
    await api.listGitConnections();
    expect(lastCall()).toMatchObject({ url: '/api/git-connections', method: 'GET' });

    await api.connectGitWithToken('github', 'ghp_x');
    expect(lastCall()).toMatchObject({ url: '/api/git-connections/github', method: 'PUT', body: { token: 'ghp_x' } });

    await api.disconnectGit('github');
    expect(lastCall()).toMatchObject({ url: '/api/git-connections/github', method: 'DELETE' });
  });

  it('starts the GitHub OAuth flow with the page to come back to, and lists repos for the picker', async () => {
    fetchMock.mockResolvedValueOnce(ok({ url: 'https://github.com/login/oauth/authorize?x=1' }));
    expect(await api.startGitHubConnect('http://localhost:5173/')).toEqual({ url: 'https://github.com/login/oauth/authorize?x=1' });
    expect(lastCall()).toMatchObject({ url: '/api/git-connections/github/oauth/start', method: 'POST', body: { returnTo: 'http://localhost:5173/' } });

    await api.completeGitHubConnect('ticket-123');
    expect(lastCall()).toMatchObject({ url: '/api/git-connections/github/oauth/complete', method: 'POST', body: { ticket: 'ticket-123' } });

    await api.listGitRepos('github');
    expect(lastCall()).toMatchObject({ url: '/api/git-connections/github/repos', method: 'GET' });
  });
});
