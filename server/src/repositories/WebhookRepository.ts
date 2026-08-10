import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToWebhook } from '../db/mappers';
import type { WebhookSubscription } from '../domain';

/** CRUD for outbound webhook subscription definitions. Delivery lives in {@link EventEngine}. */
export class WebhookRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async list(): Promise<WebhookSubscription[]> {
    return (await this.db.selectFrom('webhook_subscriptions').selectAll().execute()).map(rowToWebhook);
  }

  async create(hook: WebhookSubscription): Promise<WebhookSubscription> {
    await this.db
      .insertInto('webhook_subscriptions')
      .values({
        id: hook.id,
        workspace_id: hook.workspaceId,
        target_url: hook.targetUrl,
        secret: hook.secret,
        event_filter: JSON.stringify(hook.eventFilter),
        enabled: hook.enabled ? 1 : 0,
        created_by: hook.createdBy,
      })
      .execute();
    persistState();
    return hook;
  }

  async update(id: string, changes: Partial<Pick<WebhookSubscription, 'targetUrl' | 'eventFilter' | 'enabled'>>): Promise<WebhookSubscription | undefined> {
    const existing = (await this.list()).find((h) => h.id === id);
    if (!existing) return undefined;
    const merged = { ...existing, ...changes };
    await this.db
      .updateTable('webhook_subscriptions')
      .set({ target_url: merged.targetUrl, event_filter: JSON.stringify(merged.eventFilter), enabled: merged.enabled ? 1 : 0 })
      .where('id', '=', id)
      .execute();
    persistState();
    return merged;
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('webhook_subscriptions').where('id', '=', id).execute();
    persistState();
  }
}
