import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestEngine, seedHumanUser, seedIssue, seedWorkspace, waitFor } from './helpers';

describe('EventEngine webhook dispatch (via emitEvent)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function setup() {
    const { db } = await import('../src/db/core');
    await seedWorkspace(db);
    const { engine, userRepo, issueRepo, webhookRepo, webhookDeliveryRepo } = createTestEngine(db);
    const reporter = await seedHumanUser(userRepo, 'reporter@example.com', 'Reporter');
    const issue = await seedIssue(issueRepo, { reporterId: reporter.id });
    return { engine, webhookRepo, webhookDeliveryRepo, reporter, issue };
  }

  it('records a success delivery for an enabled, matching webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { engine, webhookRepo, webhookDeliveryRepo, reporter, issue } = await setup();
    const hook = await webhookRepo.create({
      id: 'hook_match', workspaceId: 'ws_test', targetUrl: 'https://example.test/hook',
      secret: 'shh', eventFilter: '*', enabled: true, createdBy: reporter.id,
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.statusChanged', issueId: issue.id, fromStatusId: 'st_todo', toStatusId: 'st_inprogress' },
    });

    const deliveries = await waitFor(() => webhookDeliveryRepo.listForWebhook(hook.id, 20, 0).then((r) => r.deliveries));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('success');
    expect(deliveries[0].statusCode).toBe(200);
  });

  it('records a failure delivery, without emitEvent itself throwing, when the target is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    vi.stubGlobal('fetch', fetchMock);
    const { engine, webhookRepo, webhookDeliveryRepo, reporter, issue } = await setup();
    const hook = await webhookRepo.create({
      id: 'hook_unreachable', workspaceId: 'ws_test', targetUrl: 'https://unreachable.test/hook',
      secret: 'shh', eventFilter: '*', enabled: true, createdBy: reporter.id,
    });

    await expect(
      engine.emitEvent({
        actor: { kind: 'user', userId: reporter.id },
        subject: { type: 'issue', id: issue.id },
        payload: { type: 'issue.statusChanged', issueId: issue.id, fromStatusId: 'st_todo', toStatusId: 'st_inprogress' },
      }),
    ).resolves.toBeDefined();

    const deliveries = await waitFor(() => webhookDeliveryRepo.listForWebhook(hook.id, 20, 0).then((r) => r.deliveries));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].status).toBe('failure');
    expect(deliveries[0].error).toContain('ENOTFOUND');
  });

  it('skips a disabled hook and a hook whose eventFilter does not match', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { engine, webhookRepo, webhookDeliveryRepo, reporter, issue } = await setup();
    const disabled = await webhookRepo.create({
      id: 'hook_disabled', workspaceId: 'ws_test', targetUrl: 'https://example.test/disabled',
      secret: 'shh', eventFilter: '*', enabled: false, createdBy: reporter.id,
    });
    const nonMatching = await webhookRepo.create({
      id: 'hook_filtered', workspaceId: 'ws_test', targetUrl: 'https://example.test/filtered',
      secret: 'shh', eventFilter: ['comment.created'], enabled: true, createdBy: reporter.id,
    });

    await engine.emitEvent({
      actor: { kind: 'user', userId: reporter.id },
      subject: { type: 'issue', id: issue.id },
      payload: { type: 'issue.statusChanged', issueId: issue.id, fromStatusId: 'st_todo', toStatusId: 'st_inprogress' },
    });
    // Nothing to wait for landing (that's the point) — give any stray fire-and-forget work a
    // moment to have run, then assert it produced no rows.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).not.toHaveBeenCalled();
    expect((await webhookDeliveryRepo.listForWebhook(disabled.id, 20, 0)).deliveries).toHaveLength(0);
    expect((await webhookDeliveryRepo.listForWebhook(nonMatching.id, 20, 0)).deliveries).toHaveLength(0);
  });
});
