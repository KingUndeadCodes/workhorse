import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const user = { id: 'u1', email: 'a@example.com', displayName: 'Alex', kind: 'human' };
const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

// auth.ts reads localStorage once at import time, so each test gets a fresh module.
async function load() {
  vi.resetModules();
  return import('../src/lib/stores/auth');
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('auth store', () => {
  it('starts logged out with nothing stored', async () => {
    const auth = await load();
    expect(get(auth.authToken)).toBeNull();
    expect(get(auth.currentUser)).toBeNull();
  });

  it('restores a previous login from localStorage, and ignores corrupt data', async () => {
    localStorage.setItem('anvil.auth', JSON.stringify({ token: 't', user }));
    expect(get((await load()).currentUser)).toEqual(user);

    localStorage.setItem('anvil.auth', '{not json');
    expect(get((await load()).authToken)).toBeNull();
  });

  it('login stores the token and user, and persists them', async () => {
    vi.stubGlobal('fetch', respond({ token: 'tok', user }));
    const auth = await load();

    await auth.login('a@example.com', 'pw');

    expect(get(auth.authToken)).toBe('tok');
    expect(get(auth.currentUser)).toEqual(user);
    expect(JSON.parse(localStorage.getItem('anvil.auth')!)).toEqual({ token: 'tok', user });
  });

  it('a failed login throws the server\'s message and stores nothing', async () => {
    vi.stubGlobal('fetch', respond({ error: 'Invalid email or password' }, 401));
    const auth = await load();

    await expect(auth.login('a@example.com', 'wrong')).rejects.toThrow('Invalid email or password');

    expect(get(auth.authToken)).toBeNull();
    expect(localStorage.getItem('anvil.auth')).toBeNull();
  });

  it('signup posts the display name and logs the new user in', async () => {
    const fetchMock = respond({ token: 'tok', user });
    vi.stubGlobal('fetch', fetchMock);
    const auth = await load();

    await auth.signup('a@example.com', 'pw', 'Alex');

    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ email: 'a@example.com', password: 'pw', displayName: 'Alex' });
    expect(get(auth.currentUser)).toEqual(user);
  });

  it('logout clears state and storage', async () => {
    localStorage.setItem('anvil.auth', JSON.stringify({ token: 't', user }));
    const auth = await load();

    auth.logout();

    expect(get(auth.authToken)).toBeNull();
    expect(get(auth.currentUser)).toBeNull();
    expect(localStorage.getItem('anvil.auth')).toBeNull();
  });

  it('setCurrentUser updates the profile but keeps the token — and does nothing when logged out', async () => {
    const loggedOut = await load();
    loggedOut.setCurrentUser({ ...user, displayName: 'Nobody' } as never);
    expect(get(loggedOut.currentUser)).toBeNull();

    localStorage.setItem('anvil.auth', JSON.stringify({ token: 't', user }));
    const auth = await load();
    auth.setCurrentUser({ ...user, displayName: 'Renamed' } as never);
    expect(get(auth.authToken)).toBe('t');
    expect(JSON.parse(localStorage.getItem('anvil.auth')!).user.displayName).toBe('Renamed');
  });
});
