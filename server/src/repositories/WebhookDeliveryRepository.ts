import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToWebhookDelivery } from '../db/mappers';
import type { WebhookDelivery } from '../domain';

/**
 * Storage for outbound webhook delivery attempts — created by {@link EventEngine.deliverToWebhook},
 * read by routes/webhooks.ts. Every read here is scoped to one `webhookId`; there's no
 * cross-webhook listing since a delivery only ever matters in the context of the hook it belongs to.
 */
export class WebhookDeliveryRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async create(delivery: WebhookDelivery): Promise<WebhookDelivery> {
    await this.db
      .insertInto('webhook_deliveries')
      .values({
        id: delivery.id,
        webhook_id: delivery.webhookId,
        event_id: delivery.eventId,
        event_type: delivery.eventType,
        status: delivery.status,
        status_code: delivery.statusCode ?? null,
        error: delivery.error ?? null,
        created_at: delivery.createdAt,
      })
      .execute();
    persistState();
    return delivery;
  }

  /** Most recent first. `limit`+1 is fetched so the caller can tell whether another page exists without a separate count query. */
  async listForWebhook(webhookId: string, limit: number, offset: number): Promise<{ deliveries: WebhookDelivery[]; hasMore: boolean }> {
    const rows = await this.db
      .selectFrom('webhook_deliveries')
      .selectAll()
      .where('webhook_id', '=', webhookId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .offset(offset)
      .execute();
    const hasMore = rows.length > limit;
    return { deliveries: rows.slice(0, limit).map(rowToWebhookDelivery), hasMore };
  }

  /** Called when the parent webhook is deleted, so its history doesn't linger as orphaned rows. */
  async deleteForWebhook(webhookId: string): Promise<void> {
    await this.db.deleteFrom('webhook_deliveries').where('webhook_id', '=', webhookId).execute();
    persistState();
  }
}
