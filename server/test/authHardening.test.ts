import { describe, expect, it, vi } from 'vitest';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../src/auth/password';
import { createRateLimiter } from '../src/auth/rateLimit';
import { seedWorkflow, seedWorkspace } from './helpers';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret');
vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-encryption-key');

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash).toMatch(/^scrypt\$16384\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('salts every hash differently', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('does not block the event loop while deriving (the sync version stalled every other request)', async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    await Promise.all(Array.from({ length: 4 }, () => hashPassword('x')));
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(0);
  });

  it('refuses a stored hash that names a cost parameter outside the allowlist, instead of hanging or exhausting memory', async () => {
    const hash = await hashPassword('pw');
    const [, , salt, digest] = hash.split('$');
    for (const bad of ['1048576', '1073741824', '0', '-1', 'NaN', '', '16385']) {
      expect(await verifyPassword('pw', `scrypt$${bad}$${salt}$${digest}`)).toBe(false);
    }
  });

  it('rejects malformed or truncated hashes and unknown schemes without throwing', async () => {
    const hash = await hashPassword('pw');
    for (const bad of ['', 'garbage', 'bcrypt$10$aa$bb', 'scrypt$16384$$', 'scrypt$16384$abcd$abcd', `${hash}$extra`]) {
      expect(await verifyPassword('pw', bad)).toBe(false);
    }
  });

  it('burnPasswordCheck always says no, but does the real work (so unknown emails cost the same as wrong passwords)', async () => {
    expect(await burnPasswordCheck('anything')).toBe(false);
    expect(await burnPasswordCheck('workhorse-timing-equalizer')).toBe(false);
  });
});

describe('rate limiter', () => {
  it('allows up to max attempts per window, then reports how long to wait', () => {
    let t = 0;
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000, now: () => t });
    expect([1, 2, 3].map(() => limiter.hit('a').ok)).toEqual([true, true, true]);
    const blocked = limiter.hit('a');
    expect(blocked).toEqual({ ok: false, retryAfterSeconds: 60 });
    t = 45_000;
    expect(limiter.hit('a')).toEqual({ ok: false, retryAfterSeconds: 15 });
  });

  it('keys are independent, the window reopens, and reset() forgives a key', () => {
    let t = 0;
    const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: () => t });
    expect(limiter.hit('a').ok).toBe(true);
    expect(limiter.hit('a').ok).toBe(false);
    expect(limiter.hit('b').ok).toBe(true);
    t = 1001;
    expect(limiter.hit('a').ok).toBe(true);
    expect(limiter.hit('a').ok).toBe(false);
    limiter.reset('a');
    expect(limiter.hit('a').ok).toBe(true);
  });
});

async function boot() {
  const { db } = await import('../src/db/core');
  const workspaceId = await seedWorkspace(db);
  await seedWorkflow(db);
  const container = await import('../src/container');
  container.initContainer();
  const { app } = await import('../src/app');
  const user = await container.userRepo.createHuman('member@example.com', 'Member', await hashPassword('correct horse'));
  await container.workspaceRepo.addMember(workspaceId, user.id, 'member', new Date().toISOString());
  const { signToken } = await import('../src/auth/jwt');
  const token = await signToken(user);
  const call = (path: string, init: { method?: string; body?: unknown; raw?: string } = {}) =>
    app.request(`/api${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    });
  const login = (email: string, password: string) =>
    app.request('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return { app, call, login, container };
}

describe('login route', () => {
  it('locks an email out after repeated attempts (429 + Retry-After), even with the right password afterwards', async () => {
    const { login } = await boot();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await login('victim@example.com', `guess${i}`)).status);

    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    const blocked = await login('victim@example.com', 'x');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('a successful login clears that email\'s counter', async () => {
    const { login } = await boot();
    for (let i = 0; i < 8; i++) await login('member@example.com', 'wrong');
    expect((await login('member@example.com', 'correct horse')).status).toBe(200);
    for (let i = 0; i < 8; i++) expect((await login('member@example.com', 'wrong')).status).toBe(401);
  });

  it('answers an unknown email and a wrong password identically', async () => {
    const { login } = await boot();
    const unknown = await login('nobody-here@example.com', 'whatever');
    const wrong = await login('member@example.com', 'whatever');
    expect(unknown.status).toBe(wrong.status);
    expect(await unknown.json()).toEqual(await wrong.json());
  });
});

describe('request size limit', () => {
  it('rejects an oversized body with 413 before it is parsed', async () => {
    const { call } = await boot();
    const huge = JSON.stringify({ avatarUrl: 'x'.repeat(6 * 1024 * 1024) });
    expect((await call('/auth/me', { method: 'PATCH', raw: huge })).status).toBe(413);
  });

  it('still accepts a normal body', async () => {
    const { call } = await boot();
    expect((await call('/auth/me', { method: 'PATCH', body: { displayName: 'Renamed' } })).status).toBe(200);
  });
});

describe('automation rules: the server decides the id', () => {
  const rule = { projectId: null, name: 'r', enabled: true, eventFilter: ['issue.created'], conditions: [], actions: [] };

  it('ignores a client-supplied id and any stray field on create', async () => {
    const { call, container } = await boot();
    const first = (await (await call('/automations', { method: 'POST', body: { ...rule, id: 'rule_chosen_by_client', isAdmin: true } })).json()) as { id: string };
    expect(first.id).not.toBe('rule_chosen_by_client');
    expect(first.id).toMatch(/^rule_/);
    expect(first).not.toHaveProperty('isAdmin');
    expect((await container.automationRepo.list()).map((r) => r.id)).toEqual([first.id]);
  });

  it('cannot overwrite or collide with an existing rule by naming its id', async () => {
    const { call, container } = await boot();
    const victim = (await (await call('/automations', { method: 'POST', body: { ...rule, name: 'victim' } })).json()) as { id: string };
    const attacker = (await (await call('/automations', { method: 'POST', body: { ...rule, name: 'attacker', id: victim.id } })).json()) as { id: string };

    expect(attacker.id).not.toBe(victim.id);
    expect((await container.automationRepo.list()).map((r) => r.name).sort()).toEqual(['attacker', 'victim']);
  });

  it('PATCH changes only the editable fields and never the id', async () => {
    const { call } = await boot();
    const created = (await (await call('/automations', { method: 'POST', body: rule })).json()) as { id: string };

    const patched = (await (await call(`/automations/${created.id}`, { method: 'PATCH', body: { name: 'renamed', enabled: false, id: 'rule_hijack' } })).json()) as { id: string; name: string; enabled: boolean };

    expect(patched).toMatchObject({ id: created.id, name: 'renamed', enabled: false });
  });
});
