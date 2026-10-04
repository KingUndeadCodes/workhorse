import { describe, expect, it } from 'vitest';
import { UserGitConnectionRepository } from '../src/repositories/UserGitConnectionRepository';
import { GitAuthResolver } from '../src/services/GitAuthResolver';
import type { GitRepoLink, UserGitConnection } from '../src/domain';

async function repo() {
  const { db } = await import('../src/db/core');
  return { db, r: new UserGitConnectionRepository(db) };
}

function conn(overrides: Partial<UserGitConnection> = {}): UserGitConnection {
  return { userId: 'u_1', provider: 'github', auth: { kind: 'token', token: 'super-secret-pat' }, accountLogin: 'octocat', createdAt: new Date().toISOString(), ...overrides };
}

describe('UserGitConnectionRepository', () => {
  it('round-trips both auth kinds as plaintext to the caller', async () => {
    const { r } = await repo();
    await r.upsert(conn());
    await r.upsert(conn({ userId: 'u_2', auth: { kind: 'oauth', accessToken: 'gho_secret' } }));

    expect((await r.get('u_1', 'github'))?.auth).toEqual({ kind: 'token', token: 'super-secret-pat' });
    expect((await r.get('u_2', 'github'))?.auth).toEqual({ kind: 'oauth', accessToken: 'gho_secret' });
    expect((await r.get('u_1', 'github'))?.accountLogin).toBe('octocat');
  });

  it('never stores the secret in plaintext', async () => {
    const { db, r } = await repo();
    await r.upsert(conn());

    const row = await db.selectFrom('user_git_connections').selectAll().executeTakeFirstOrThrow();
    expect(row.token).not.toBe('super-secret-pat');
    expect(row.token).toMatch(/^gcm1:/);
  });

  it('encryptLegacyPlaintext encrypts a plaintext row once and leaves it readable', async () => {
    const { db, r } = await repo();
    await db.insertInto('user_git_connections').values({ user_id: 'u_1', provider: 'github', auth_kind: 'token', token: 'old-plaintext-pat', account_login: null, created_at: '' }).execute();

    await r.encryptLegacyPlaintext();
    const row = await db.selectFrom('user_git_connections').selectAll().executeTakeFirstOrThrow();
    expect(row.token).toMatch(/^gcm1:/);
    expect((await r.get('u_1', 'github'))?.auth).toEqual({ kind: 'token', token: 'old-plaintext-pat' });

    await r.encryptLegacyPlaintext();
    expect((await db.selectFrom('user_git_connections').selectAll().executeTakeFirstOrThrow()).token).toBe(row.token);
  });

  it('upsert replaces the previous connection for the same user and provider', async () => {
    const { r } = await repo();
    await r.upsert(conn());
    await r.upsert(conn({ auth: { kind: 'oauth', accessToken: 'gho_new' }, accountLogin: 'renamed' }));

    expect((await r.listForUser('u_1')).length).toBe(1);
    expect((await r.get('u_1', 'github'))?.auth).toEqual({ kind: 'oauth', accessToken: 'gho_new' });
  });

  it('listForUser returns only that user\'s connections', async () => {
    const { r } = await repo();
    await r.upsert(conn());
    await r.upsert(conn({ provider: 'gitlab-like' }));
    await r.upsert(conn({ userId: 'u_2' }));

    expect((await r.listForUser('u_1')).map((c) => c.provider).sort()).toEqual(['github', 'gitlab-like']);
    expect(await r.listForUser('nobody')).toEqual([]);
  });

  it('delete removes only that user\'s connection', async () => {
    const { r } = await repo();
    await r.upsert(conn());
    await r.upsert(conn({ userId: 'u_2' }));
    await r.delete('u_1', 'github');

    expect(await r.get('u_1', 'github')).toBeUndefined();
    expect(await r.get('u_2', 'github')).toBeDefined();
  });
});

describe('GitAuthResolver', () => {
  const link: GitRepoLink = { id: 'l', projectId: 'p', provider: 'github', owner: 'a', repo: 'b', defaultBranch: 'main', createdAt: '', createdBy: 'creator' };

  it('uses the first candidate that has a connection, and throws when none does', async () => {
    const { r } = await repo();
    const resolver = new GitAuthResolver(r);
    await r.upsert(conn({ userId: 'approver', auth: { kind: 'token', token: 'approver-token' } }));
    await r.upsert(conn({ userId: 'asker', auth: { kind: 'token', token: 'asker-token' } }));

    expect(await resolver.resolve(link, ['approver', 'asker'])).toEqual({ kind: 'token', token: 'approver-token' });
    expect(await resolver.resolve(link, [undefined, 'asker'])).toEqual({ kind: 'token', token: 'asker-token' });
    await expect(resolver.resolve(link, ['nobody'])).rejects.toThrow(/No github account is connected/);
    await expect(resolver.resolve(link, [])).rejects.toThrow(/No github account is connected/);
  });

  it("never falls back to the link creator's connection — otherwise anyone could act with it", async () => {
    const { r } = await repo();
    await r.upsert(conn({ userId: 'creator', auth: { kind: 'token', token: 'creator-token' } }));

    await expect(new GitAuthResolver(r).resolve(link, ['someone-else'])).rejects.toThrow(/No github account is connected/);
  });

  it('needs no credential for local', async () => {
    const { r } = await repo();
    expect(await new GitAuthResolver(r).resolve({ ...link, provider: 'local' }, [])).toEqual({ kind: 'token', token: '' });
  });
});
