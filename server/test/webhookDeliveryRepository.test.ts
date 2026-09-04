import { describe, expect, it } from 'vitest';
import { WebhookDeliveryRepository } from '../src/repositories/WebhookDeliveryRepository';
import type { WebhookDelivery } from '../src/domain';

function makeDelivery(overrides: Partial<WebhookDelivery> & { id: string; webhookId: string }): WebhookDelivery {
  return {
    eventId: `evt_${overrides.id}`,
    eventType: 'issue.statusChanged',
    status: 'success',
    statusCode: 200,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('WebhookDeliveryRepository', () => {
  async function repos() {
    const { db } = await import('../src/db/core');
    return { deliveryRepo: new WebhookDeliveryRepository(db) };
  }

  it('lists a webhook deliveries most-recent-first, with correct hasMore', async () => {
    const { deliveryRepo } = await repos();
    for (let i = 0; i < 3; i++) {
      await deliveryRepo.create(makeDelivery({ id: `d${i}`, webhookId: 'hook_1', createdAt: new Date(2026, 0, i + 1).toISOString() }));
    }
    // A delivery for a different webhook must never show up in hook_1's list.
    await deliveryRepo.create(makeDelivery({ id: 'other', webhookId: 'hook_2' }));

    const firstPage = await deliveryRepo.listForWebhook('hook_1', 2, 0);
    expect(firstPage.deliveries.map((d) => d.id)).toEqual(['d2', 'd1']);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await deliveryRepo.listForWebhook('hook_1', 2, 2);
    expect(secondPage.deliveries.map((d) => d.id)).toEqual(['d0']);
    expect(secondPage.hasMore).toBe(false);
  });

  it('deleteForWebhook removes only that webhook deliveries', async () => {
    const { deliveryRepo } = await repos();
    await deliveryRepo.create(makeDelivery({ id: 'd1', webhookId: 'hook_1' }));
    await deliveryRepo.create(makeDelivery({ id: 'd2', webhookId: 'hook_2' }));

    await deliveryRepo.deleteForWebhook('hook_1');

    expect((await deliveryRepo.listForWebhook('hook_1', 20, 0)).deliveries).toHaveLength(0);
    expect((await deliveryRepo.listForWebhook('hook_2', 20, 0)).deliveries).toHaveLength(1);
  });

  it('stores a failure delivery with an error message and no statusCode', async () => {
    const { deliveryRepo } = await repos();
    await deliveryRepo.create(makeDelivery({ id: 'd1', webhookId: 'hook_1', status: 'failure', statusCode: undefined, error: 'fetch failed' }));

    const { deliveries } = await deliveryRepo.listForWebhook('hook_1', 20, 0);
    expect(deliveries[0].status).toBe('failure');
    expect(deliveries[0].statusCode).toBeUndefined();
    expect(deliveries[0].error).toBe('fetch failed');
  });
});
