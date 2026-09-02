import { Hono } from 'hono';
import type { AuthVariables } from '../auth/middleware';
import { issueRepo, notificationRepo, userRepo, workflowRepo } from '../container';
import { getEventById } from '../eventLog';
import { actorForEvent, computeNotificationContext } from '../services/notificationContext';
import type { Notification } from '../domain';

export const notificationsRouter = new Hono<{ Variables: AuthVariables }>();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Layers display context onto a stored row via the same `computeNotificationContext` the live
 * WebSocket push uses (see EventEngine.notifyRecipients) — re-fetching the triggering event
 * and issue by id here, since a REST read (unlike the live push) doesn't already have them in
 * hand. Returns context fields as `undefined` rather than omitting the notification if the
 * underlying issue or event has since been deleted — the row still exists and should still
 * show up as "about a since-removed issue" instead of vanishing from someone's list.
 */
async function enrichNotification(n: Notification) {
  const [issue, event] = await Promise.all([issueRepo.get(n.issueId), Promise.resolve(getEventById(n.eventId))]);
  const actor = event ? await actorForEvent(event, userRepo) : undefined;
  const context = await computeNotificationContext(event, issue, actor, workflowRepo);
  return { ...n, ...context };
}

/** GET /api/notifications?limit=&offset= — the current user's own notifications, most recent first. */
notificationsRouter.get('/notifications', async (c) => {
  const userId = c.get('user').id;
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
  const { notifications, hasMore } = await notificationRepo.listForUser(userId, limit, offset);
  return c.json({ notifications: await Promise.all(notifications.map(enrichNotification)), hasMore });
});

/** GET /api/notifications/unread-count — for the bell badge; cheap enough to poll on reconnect without fetching the full list. */
notificationsRouter.get('/notifications/unread-count', async (c) => {
  return c.json({ count: await notificationRepo.countUnread(c.get('user').id) });
});

/** POST /api/notifications/:id/read — marks one of the current user's own notifications read; 404 (not 403) if it isn't theirs, so a guessed id reveals nothing. */
notificationsRouter.post('/notifications/:id/read', async (c) => {
  const updated = await notificationRepo.markRead(c.req.param('id'), c.get('user').id);
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(await enrichNotification(updated));
});

/** POST /api/notifications/read-all — marks every one of the current user's unread notifications read in one call, for the bell panel's "Mark all as read". */
notificationsRouter.post('/notifications/read-all', async (c) => {
  await notificationRepo.markAllRead(c.get('user').id);
  return c.json({ ok: true });
});
