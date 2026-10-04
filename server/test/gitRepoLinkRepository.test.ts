import { describe, expect, it } from 'vitest';
import { GitRepoLinkRepository } from '../src/repositories/GitRepoLinkRepository';
import type { GitRepoLink } from '../src/domain';

describe('GitRepoLinkRepository', () => {
  async function repo() {
    const { db } = await import('../src/db/core');
    return new GitRepoLinkRepository(db);
  }

  function makeLink(overrides: Partial<GitRepoLink> = {}): GitRepoLink {
    return {
      id: 'gitlink_1',
      projectId: 'proj_1',
      provider: 'github',
      owner: 'acme',
      repo: 'widgets',
      defaultBranch: 'main',
      createdAt: new Date().toISOString(),
      createdBy: 'u_1',
      ...overrides,
    };
  }

  it('round-trips a link through create/getForProject', async () => {
    const r = await repo();
    const link = makeLink();
    await r.create(link);

    expect(await r.getForProject('proj_1')).toEqual(link);
  });

  it('create replaces any existing link for the same project ("latest wins")', async () => {
    const r = await repo();
    await r.create(makeLink({ id: 'gitlink_1', repo: 'widgets' }));
    await r.create(makeLink({ id: 'gitlink_2', repo: 'gadgets' }));

    const fetched = await r.getForProject('proj_1');
    expect(fetched?.id).toBe('gitlink_2');
    expect(fetched?.repo).toBe('gadgets');
  });

  it('getForProject returns undefined when no link exists', async () => {
    const r = await repo();
    expect(await r.getForProject('proj_missing')).toBeUndefined();
  });

  it('delete removes the link', async () => {
    const r = await repo();
    await r.create(makeLink());
    await r.delete('proj_1');
    expect(await r.getForProject('proj_1')).toBeUndefined();
  });
});
