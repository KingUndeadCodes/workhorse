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

  return { container, person, login };
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
