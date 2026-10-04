import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Comment, GitRepoLink, Issue } from '$domain';

vi.mock('../src/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/api')>()),
  linkGitRepo: vi.fn(),
  unlinkGitRepo: vi.fn(async () => ({ ok: true })),
  deleteIssue: vi.fn(async () => ({})),
  deleteComment: vi.fn(async () => ({})),
  postComment: vi.fn(),
  patchIssueStatus: vi.fn(),
}));

import * as api from '../src/lib/api';
import * as ws from '../src/lib/stores/workspace';

const comment = (id: string, parentCommentId?: string, issueId = 'i1') => ({ id, issueId, parentCommentId, body: id }) as unknown as Comment;
const issue = (id: string, overrides: Partial<Issue> = {}) => ({ id, statusId: 'todo', ...overrides }) as Issue;

beforeEach(() => {
  vi.clearAllMocks();
  for (const store of [ws.comments, ws.issuesStore, ws.issueLinks, ws.worklogs, ws.attachments]) store.set([]);
  ws.gitRepoLink.set(null);
  ws.selectedIssueId.set(null);
});

describe('git repo link', () => {
  const link = { id: 'gl1', projectId: 'p1', provider: 'github', owner: 'acme', repo: 'widgets', defaultBranch: 'main' } as GitRepoLink;

  it('linkGitRepo stores what the server returns', async () => {
    vi.mocked(api.linkGitRepo).mockResolvedValueOnce(link);
    await ws.linkGitRepo('p1', { provider: 'github', owner: 'acme', repo: 'widgets' });
    expect(get(ws.gitRepoLink)).toEqual(link);
  });

  it('a rejected link leaves the previous state untouched, so the form can show the error', async () => {
    ws.gitRepoLink.set(link);
    vi.mocked(api.linkGitRepo).mockRejectedValueOnce(new Error('No github account is connected'));
    await expect(ws.linkGitRepo('p1', { provider: 'github', owner: 'x', repo: 'y' })).rejects.toThrow('No github account');
    expect(get(ws.gitRepoLink)).toEqual(link);
  });

  it('unlinkGitRepo clears it', async () => {
    ws.gitRepoLink.set(link);
    await ws.unlinkGitRepo('p1');
    expect(get(ws.gitRepoLink)).toBeNull();
  });
});

describe('comments', () => {
  it('addComment appends the server\'s copy', async () => {
    vi.mocked(api.postComment).mockResolvedValueOnce({ comment: comment('c1') } as never);
    await ws.addComment('i1', 'hello');
    expect(get(ws.comments).map((c) => c.id)).toEqual(['c1']);
  });

  it('addComment does not duplicate a comment the websocket already delivered (a duplicate id crashes the keyed {#each})', async () => {
    ws.comments.set([comment('c1')]);
    vi.mocked(api.postComment).mockResolvedValueOnce({ comment: comment('c1') } as never);
    await ws.addComment('i1', 'hello');
    expect(get(ws.comments)).toHaveLength(1);
  });

  it('removeComment drops the whole reply subtree after the API call succeeds', async () => {
    ws.comments.set([comment('a'), comment('b', 'a'), comment('c', 'b'), comment('x')]);
    await ws.removeComment('i1', 'a');
    expect(get(ws.comments).map((c) => c.id)).toEqual(['x']);
  });

  it('removeComment keeps everything if the API call fails', async () => {
    ws.comments.set([comment('a'), comment('b', 'a')]);
    vi.mocked(api.deleteComment).mockRejectedValueOnce(new Error('forbidden'));
    await expect(ws.removeComment('i1', 'a')).rejects.toThrow('forbidden');
    expect(get(ws.comments)).toHaveLength(2);
  });
});

describe('issues', () => {
  it('deleteIssue clears the issue and everything cached about it, and deselects it', async () => {
    ws.issuesStore.set([issue('i1'), issue('i2')]);
    ws.comments.set([comment('c1', undefined, 'i1'), comment('c2', undefined, 'i2')]);
    ws.issueLinks.set([{ id: 'l1', sourceIssueId: 'i1', targetIssueId: 'i2' }, { id: 'l2', sourceIssueId: 'i2', targetIssueId: 'i3' }] as never);
    ws.worklogs.set([{ id: 'w1', issueId: 'i1' }, { id: 'w2', issueId: 'i2' }] as never);
    ws.attachments.set([{ id: 'a1', issueId: 'i1' }] as never);
    ws.selectedIssueId.set('i1');

    await ws.deleteIssue('i1');

    expect(get(ws.issuesStore).map((i) => i.id)).toEqual(['i2']);
    expect(get(ws.comments).map((c) => c.id)).toEqual(['c2']);
    expect(get(ws.issueLinks).map((l) => l.id)).toEqual(['l2']);
    expect(get(ws.worklogs).map((w) => w.id)).toEqual(['w2']);
    expect(get(ws.attachments)).toEqual([]);
    expect(get(ws.selectedIssueId)).toBeNull();
  });

  it('deleteIssue leaves another issue selected', async () => {
    ws.issuesStore.set([issue('i1'), issue('i2')]);
    ws.selectedIssueId.set('i2');
    await ws.deleteIssue('i1');
    expect(get(ws.selectedIssueId)).toBe('i2');
  });

  it('moveIssueToStatus applies the server\'s response only once it arrives', async () => {
    ws.issuesStore.set([issue('i1', { statusId: 'todo' })]);
    vi.mocked(api.patchIssueStatus).mockResolvedValueOnce({ issue: issue('i1', { statusId: 'done' }), event: null });

    await ws.moveIssueToStatus('i1', 'done');

    expect(get(ws.issuesStore)[0].statusId).toBe('done');
  });

  it('moveIssueToStatus leaves the card where it was if the server refuses', async () => {
    ws.issuesStore.set([issue('i1', { statusId: 'todo' })]);
    vi.mocked(api.patchIssueStatus).mockRejectedValueOnce(new Error('transition not allowed'));

    await expect(ws.moveIssueToStatus('i1', 'done')).rejects.toThrow();

    expect(get(ws.issuesStore)[0].statusId).toBe('todo');
  });
});
