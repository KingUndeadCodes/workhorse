import { describe, expect, it, vi } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { seedWorkflow, seedWorkspace } from './helpers';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret');
vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-encryption-key');

const PASSWORD = 'correct horse';

async function boot() {
  const { db } = await import('../src/db/core');
  const workspaceId = await seedWorkspace(db);
  await seedWorkflow(db);
  const container = await import('../src/container');
  container.initContainer();
  const { signToken } = await import('../src/auth/jwt');
  const { app } = await import('../src/app');

  async function person(name: string) {
    const user = await container.userRepo.createHuman(`${name}@example.com`, name, await hashPassword(PASSWORD));
    await container.workspaceRepo.addMember(workspaceId, user.id, 'member', new Date().toISOString());
    const token = await signToken(user);
    return {
      user,
      call: (path: string, init: { method?: string; body?: unknown; anonymous?: boolean } = {}) =>
        app.request(`/api${path}`, {
          method: init.method ?? 'GET',
          headers: { ...(init.anonymous ? {} : { authorization: `Bearer ${token}` }), 'content-type': 'application/json' },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        }),
    };
  }
  const login = (email: string, password: string) =>
    app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });

  return { container, person, login, app };
}

describe('POST /api/auth/password', () => {
  it('changes the password: the new one logs in, the old one no longer does', async () => {
    const { person, login } = await boot();
    const alice = await person('alice');
    const res = await alice.call('/auth/password', { method: 'POST', body: { currentPassword: PASSWORD, newPassword: 'battery staple 9' } });
    expect(res.status).toBe(200);
    expect((await login('alice@example.com', 'battery staple 9')).status).toBe(200);
    expect((await login('alice@example.com', PASSWORD)).status).toBe(401);
  });

  it('answers a wrong current password with 403, never 401 (a 401 would sign the user out in the app), and changes nothing', async () => {
    const { person, container } = await boot();
    const alice = await person('alice');
    const res = await alice.call('/auth/password', { method: 'POST', body: { currentPassword: 'not it', newPassword: 'battery staple 9' } });
    expect(res.status).toBe(403);
    const hash = await container.userRepo.getCredentialHash(alice.user.id);
    expect(await verifyPassword(PASSWORD, hash!)).toBe(true);
  });

  it('rejects a missing current password, a short new one, and an unchanged one', async () => {
    const { person } = await boot();
    const alice = await person('alice');
    const post = (body: unknown) => alice.call('/auth/password', { method: 'POST', body });
    expect((await post({ newPassword: 'battery staple 9' })).status).toBe(400);
    expect((await post({ currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400);
    // Length is checked before the password is, so this is 400 even though the current password is wrong.
    expect((await post({ currentPassword: 'not it', newPassword: 'short' })).status).toBe(400);
    expect((await post({ currentPassword: PASSWORD, newPassword: PASSWORD })).status).toBe(400);
  });

  it('stops after repeated wrong guesses, even for the right password', async () => {
    const { person } = await boot();
    const alice = await person('alice');
    const post = (currentPassword: string) => alice.call('/auth/password', { method: 'POST', body: { currentPassword, newPassword: 'battery staple 9' } });
    for (let i = 0; i < 5; i++) expect((await post(`guess ${i}`)).status).toBe(403);
    const blocked = await post(PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();
  });

  it('counts wrong guesses on this endpoint and on the email change toward one shared limit', async () => {
    const { person } = await boot();
    const alice = await person('alice');
    const wrongEmailChange = () => alice.call('/auth/me', { method: 'PATCH', body: { email: 'new@example.com', currentPassword: 'not it' } });
    const wrongPasswordChange = () => alice.call('/auth/password', { method: 'POST', body: { currentPassword: 'not it', newPassword: 'battery staple 9' } });
    // Three guesses against one endpoint and two against the other spend the same budget of five...
    for (let i = 0; i < 3; i++) expect((await wrongEmailChange()).status).toBe(403);
    for (let i = 0; i < 2; i++) expect((await wrongPasswordChange()).status).toBe(403);
    // ...so now both are locked, even for the right password — splitting guesses across them gains nothing.
    expect((await wrongEmailChange()).status).toBe(429);
    const rightPassword = await alice.call('/auth/password', { method: 'POST', body: { currentPassword: PASSWORD, newPassword: 'battery staple 9' } });
    expect(rightPassword.status).toBe(429);
  });

  it('needs a signed-in caller', async () => {
    const { person } = await boot();
    const alice = await person('alice');
    const res = await alice.call('/auth/password', { method: 'POST', anonymous: true, body: { currentPassword: PASSWORD, newPassword: 'battery staple 9' } });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/auth/me — changing the email needs the password', () => {
  it('rejects an email change with no password, or the wrong one, and leaves the email alone', async () => {
    const { person, container } = await boot();
    const alice = await person('alice');
    expect((await alice.call('/auth/me', { method: 'PATCH', body: { email: 'new@example.com' } })).status).toBe(400);
    expect((await alice.call('/auth/me', { method: 'PATCH', body: { email: 'new@example.com', currentPassword: 'not it' } })).status).toBe(403);
    expect((await container.userRepo.getById(alice.user.id))?.email).toBe('alice@example.com');
  });

  it('changes the email (lowercased) with the right password, and the new address can log in', async () => {
    const { person, container, login } = await boot();
    const alice = await person('alice');
    const res = await alice.call('/auth/me', { method: 'PATCH', body: { email: ' New@Example.com ', currentPassword: PASSWORD } });
    expect(res.status).toBe(200);
    expect((await container.userRepo.getById(alice.user.id))?.email).toBe('new@example.com');
    expect((await login('new@example.com', PASSWORD)).status).toBe(200);
  });

  it("doesn't reveal whether an address is taken to someone who hasn't proven the password", async () => {
    const { person } = await boot();
    const alice = await person('alice');
    await person('bob');
    expect((await alice.call('/auth/me', { method: 'PATCH', body: { email: 'bob@example.com', currentPassword: 'not it' } })).status).toBe(403);
    expect((await alice.call('/auth/me', { method: 'PATCH', body: { email: 'bob@example.com', currentPassword: PASSWORD } })).status).toBe(409);
  });

  it('still lets the name and picture change without a password, and treats resending the same email as no change', async () => {
    const { person, container } = await boot();
    const alice = await person('alice');
    const res = await alice.call('/auth/me', { method: 'PATCH', body: { displayName: 'Alice B', email: 'alice@example.com', avatarUrl: null } });
    expect(res.status).toBe(200);
    expect((await container.userRepo.getById(alice.user.id))?.displayName).toBe('Alice B');
  });
});

describe('sessions after a password change', () => {
  async function tokenIssuedAt(user: { id: string; email: string; displayName: string }, iat: number | undefined) {
    const { sign } = await import('hono/jwt');
    const { getJwtSecret } = await import('../src/auth/secret');
    const now = Math.floor(Date.now() / 1000);
    return sign({ sub: user.id, email: user.email, displayName: user.displayName, ...(iat === undefined ? {} : { iat }), exp: now + 3600 }, getJwtSecret());
  }

  it('signs out every token issued before the change, and hands back a fresh one for this session', async () => {
    const { person, app } = await boot();
    const alice = await person('alice');
    const me = (token: string) => app.request('/api/auth/me', { headers: { authorization: `Bearer ${token}` } });
    const now = Math.floor(Date.now() / 1000);
    const stolen = await tokenIssuedAt(alice.user, now - 100);
    const legacy = await tokenIssuedAt(alice.user, undefined); // minted before tokens carried an issue time
    expect((await me(stolen)).status).toBe(200);
    expect((await me(legacy)).status).toBe(200);

    const res = await alice.call('/auth/password', { method: 'POST', body: { currentPassword: PASSWORD, newPassword: 'battery staple 9' } });
    expect(res.status).toBe(200);
    const { token } = await res.json();
    expect(typeof token).toBe('string');

    expect((await me(stolen)).status).toBe(401);
    expect((await me(legacy)).status).toBe(401);
    expect((await me(token)).status).toBe(200);
  });

  it("leaves other people's tokens alone", async () => {
    const { person, app } = await boot();
    const alice = await person('alice');
    const bob = await person('bob');
    await alice.call('/auth/password', { method: 'POST', body: { currentPassword: PASSWORD, newPassword: 'battery staple 9' } });
    const res = await app.request('/api/auth/me', { headers: { authorization: `Bearer ${await tokenIssuedAt(bob.user, Math.floor(Date.now() / 1000) - 100)}` } });
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/auth/me — avatar and email normalisation', () => {
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

  it('accepts only a jpeg/png/webp data: URL (or null to remove), never an external URL', async () => {
    const { person } = await boot();
    const alice = await person('alice');
    const patch = (avatarUrl: unknown) => alice.call('/auth/me', { method: 'PATCH', body: { avatarUrl } });
    expect((await patch('https://attacker.example/pixel.png')).status).toBe(400);
    expect((await patch('javascript:alert(1)')).status).toBe(400);
    expect((await patch('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).status).toBe(400);
    expect((await patch('data:,')).status).toBe(400);
    expect((await patch(42)).status).toBe(400);
    expect((await patch(jpeg)).status).toBe(200);
    expect((await patch(null)).status).toBe(200);
  });

  it('treats an email that differs only by case or spacing as unchanged, so it needs no password', async () => {
    const { person, container } = await boot();
    const alice = await person('alice');
    const res = await alice.call('/auth/me', { method: 'PATCH', body: { email: '  ALICE@Example.com ' } });
    expect(res.status).toBe(200);
    expect((await container.userRepo.getById(alice.user.id))?.email).toBe('alice@example.com');
  });
});
