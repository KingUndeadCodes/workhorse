import { describe, expect, it } from 'vitest';
import { WebhookRepository } from '../src/repositories/WebhookRepository';
import type { WebhookSubscription } from '../src/domain';

function makeHook(overrides: Partial<WebhookSubscription> & { id: string }): WebhookSubscription {
  return {
    workspaceId: 'ws_test',
    targetUrl: 'https://example.test/hook',
    secret: 'shh',
    eventFilter: '*',
    enabled: true,
    createdBy: 'u_test',
    ...overrides,
  };
}

describe('WebhookRepository', () => {
  async function repo() {
    const { db } = await import('../src/db/core');
    return new WebhookRepository(db);
  }

  it('creates and lists webhooks', async () => {
    const webhookRepo = await repo();
    await webhookRepo.create(makeHook({ id: 'hook_1', targetUrl: 'https://a.test' }));
    await webhookRepo.create(makeHook({ id: 'hook_2', targetUrl: 'https://b.test', eventFilter: ['comment.created'] }));

    const hooks = await webhookRepo.list();
    expect(hooks.map((h) => h.id).sort()).toEqual(['hook_1', 'hook_2']);
    expect(hooks.find((h) => h.id === 'hook_2')?.eventFilter).toEqual(['comment.created']);
  });

  it('updates targetUrl/eventFilter/enabled, returning undefined for an unknown id', async () => {
    const webhookRepo = await repo();
    await webhookRepo.create(makeHook({ id: 'hook_1' }));

    const updated = await webhookRepo.update('hook_1', { enabled: false, targetUrl: 'https://changed.test' });
    expect(updated?.enabled).toBe(false);
    expect(updated?.targetUrl).toBe('https://changed.test');

    expect(await webhookRepo.update('missing', { enabled: false })).toBeUndefined();
  });

  it('deletes a webhook', async () => {
    const webhookRepo = await repo();
    await webhookRepo.create(makeHook({ id: 'hook_1' }));
    await webhookRepo.delete('hook_1');
    expect(await webhookRepo.list()).toHaveLength(0);
  });

  it('round-trips secret through create/list as plaintext to the caller', async () => {
    const webhookRepo = await repo();
    await webhookRepo.create(makeHook({ id: 'hook_1', secret: 'super-secret-hmac-key' }));

    const hooks = await webhookRepo.list();
    expect(hooks[0].secret).toBe('super-secret-hmac-key');
  });

  it('never stores the secret in plaintext in the underlying row', async () => {
    const { db } = await import('../src/db/core');
    const webhookRepo = new WebhookRepository(db);
    await webhookRepo.create(makeHook({ id: 'hook_1', secret: 'super-secret-hmac-key' }));

    const row = await db.selectFrom('webhook_subscriptions').selectAll().where('id', '=', 'hook_1').executeTakeFirstOrThrow();
    expect(row.secret).not.toBe('super-secret-hmac-key');
    expect(row.secret).toMatch(/^gcm1:/);
  });
});
