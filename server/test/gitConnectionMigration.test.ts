import { describe, expect, it } from 'vitest';
import { UserGitConnectionRepository } from '../src/repositories/UserGitConnectionRepository';

// git_repo_links used to carry its creator's credential (token + auth_kind). schema.ts moves any
// such credential onto the creator's own connection when the schema is (re-)applied at boot.
async function setup() {
  const { db } = await import('../src/db/core');
  const { migrateStateDb } = await import('../src/db/schema');
  const legacyLink = (id: string, projectId: string, provider: string, createdBy: string | null, token: string | null, authKind: string | null) =>
    db.insertInto('git_repo_links').values({ id, project_id: projectId, provider, owner: 'acme', repo: id, default_branch: 'main', token, auth_kind: authKind, created_at: '2026-01-01T00:00:00.000Z', created_by: createdBy }).execute();
  return { db, migrate: migrateStateDb, legacyLink, connections: new UserGitConnectionRepository(db) };
}

describe('git_repo_links -> user_git_connections migration', () => {
  it('moves a link\'s credential onto its creator\'s connection and clears it from the link', async () => {
    const { db, migrate, legacyLink, connections } = await setup();
    await legacyLink('l1', 'p1', 'github', 'u_creator', 'ghp_legacy', null);

    migrate();

    expect((await connections.get('u_creator', 'github'))?.auth).toEqual({ kind: 'token', token: 'ghp_legacy' });
    const row = await db.selectFrom('git_repo_links').selectAll().where('id', '=', 'l1').executeTakeFirstOrThrow();
    expect(row.token).toBeNull();
    expect(row.auth_kind).toBeNull();
  });

  it('keeps an oauth credential\'s kind', async () => {
    const { migrate, legacyLink, connections } = await setup();
    await legacyLink('l1', 'p1', 'github', 'u_creator', 'gho_legacy', 'oauth');

    migrate();

    expect((await connections.get('u_creator', 'github'))?.auth).toEqual({ kind: 'oauth', accessToken: 'gho_legacy' });
  });

  it('skips local links (their token was a throwaway) and links with no creator or no token', async () => {
    const { db, migrate, legacyLink } = await setup();
    await legacyLink('l_local', 'p1', 'local', 'u_creator', 'anything', null);
    await legacyLink('l_orphan', 'p2', 'github', null, 'ghp_orphan', null);
    await legacyLink('l_empty', 'p3', 'github', 'u_creator', '', null);

    migrate();

    expect(await db.selectFrom('user_git_connections').selectAll().execute()).toEqual([]);
  });

  it('never overwrites a connection the creator already has, and is idempotent', async () => {
    const { db, migrate, legacyLink, connections } = await setup();
    await connections.upsert({ userId: 'u_creator', provider: 'github', auth: { kind: 'oauth', accessToken: 'gho_current' }, accountLogin: 'octocat', createdAt: '2026-02-01T00:00:00.000Z' });
    await legacyLink('l1', 'p1', 'github', 'u_creator', 'ghp_stale', null);

    migrate();
    migrate();

    expect((await connections.get('u_creator', 'github'))?.auth).toEqual({ kind: 'oauth', accessToken: 'gho_current' });
    expect(await db.selectFrom('user_git_connections').selectAll().execute()).toHaveLength(1);
  });

  it('two projects by one creator collapse to a single connection', async () => {
    const { db, migrate, legacyLink } = await setup();
    await legacyLink('l1', 'p1', 'github', 'u_creator', 'ghp_one', null);
    await legacyLink('l2', 'p2', 'github', 'u_creator', 'ghp_two', null);

    migrate();

    expect(await db.selectFrom('user_git_connections').selectAll().execute()).toHaveLength(1);
  });
});
