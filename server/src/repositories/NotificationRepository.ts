import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToNotification } from '../db/mappers';
import type { Notification } from '../domain';

/**
 * Storage for in-app notifications — created by {@link EventEngine.notifyRecipients}, read by
 * routes/notifications.ts. Every read here is scoped to one `recipientUserId`; nothing in this
 * repository ever returns another user's notifications, since there's no workspace-admin view
 * onto them (unlike, say, automation rules).
 */
export class NotificationRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async create(notification: Notification): Promise<Notification> {
    await this.db
      .insertInto('notifications')
      .values({
        id: notification.id,
        workspace_id: notification.workspaceId,
        recipient_user_id: notification.recipientUserId,
        event_id: notification.eventId,
        issue_id: notification.issueId,
        kind: notification.kind,
        read: notification.read ? 1 : 0,
        read_at: notification.readAt ?? null,
        created_at: notification.createdAt,
      })
      .execute();
    persistState();
    return notification;
  }

  /** Most recent first. `limit`+1 is fetched so the caller can tell whether another page exists without a separate count query. */
  async listForUser(recipientUserId: string, limit: number, offset: number): Promise<{ notifications: Notification[]; hasMore: boolean }> {
    const rows = await this.db
      .selectFrom('notifications')
      .selectAll()
      .where('recipient_user_id', '=', recipientUserId)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit + 1)
      .offset(offset)
      .execute();
    const hasMore = rows.length > limit;
    return { notifications: rows.slice(0, limit).map(rowToNotification), hasMore };
  }

  async countUnread(recipientUserId: string): Promise<number> {
    const row = await this.db
      .selectFrom('notifications')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('recipient_user_id', '=', recipientUserId)
      .where('read', '=', 0)
      .executeTakeFirst();
    return Number(row?.count ?? 0);
  }

  async get(id: string): Promise<Notification | undefined> {
    const row = await this.db.selectFrom('notifications').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? rowToNotification(row) : undefined;
  }

  /** Scoped to `recipientUserId` so one user can never mark another's notification read via a guessed id. Returns `undefined` if the row doesn't exist or isn't theirs — routes/notifications.ts turns that into a 404 either way, so a guessed id reveals nothing. */
  async markRead(id: string, recipientUserId: string): Promise<Notification | undefined> {
    const existing = await this.get(id);
    if (!existing || existing.recipientUserId !== recipientUserId) return undefined;
    if (existing.read) return existing;
    const readAt = new Date().toISOString();
    await this.db.updateTable('notifications').set({ read: 1, read_at: readAt }).where('id', '=', id).execute();
    persistState();
    return { ...existing, read: true, readAt };
  }

  async markAllRead(recipientUserId: string): Promise<void> {
    await this.db
      .updateTable('notifications')
      .set({ read: 1, read_at: new Date().toISOString() })
      .where('recipient_user_id', '=', recipientUserId)
      .where('read', '=', 0)
      .execute();
    persistState();
  }
}
