import { get, writable } from 'svelte/store';
import {
  fetchNotifications,
  fetchUnreadNotificationCount,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationWithContext,
} from '../api';

/** Most recent first — the same order the server returns them in. */
export const notifications = writable<NotificationWithContext[]>([]);
export const unreadCount = writable(0);
/** True once the first fetch has resolved — lets the bell panel distinguish "still loading" from "genuinely empty." */
export const notificationsLoaded = writable(false);
/** Whether another older page exists — drives the panel's "Load more" affordance. */
export const hasMoreNotifications = writable(false);

const PAGE_SIZE = 20;

/** Called alongside `initWorkspace()` on login — the initial page plus the unread badge count. */
export async function initNotifications(): Promise<void> {
  const [{ notifications: list, hasMore }, { count }] = await Promise.all([fetchNotifications(PAGE_SIZE, 0), fetchUnreadNotificationCount()]);
  notifications.set(list);
  hasMoreNotifications.set(hasMore);
  unreadCount.set(count);
  notificationsLoaded.set(true);
}

/** Fetches the next older page and appends it — used by the panel's "Load more" button. */
export async function loadMoreNotifications(): Promise<void> {
  const { notifications: more, hasMore } = await fetchNotifications(PAGE_SIZE, get(notifications).length);
  notifications.update((list) => [...list, ...more]);
  hasMoreNotifications.set(hasMore);
}

/** Applied when a `{ kind: 'notification' }` WebSocket message arrives — see ws.ts. Prepends
 *  the new row and bumps the badge, the same "no polling" live-update guarantee every other
 *  store here already gets. */
export function receiveLiveNotification(n: NotificationWithContext): void {
  let isNew = true;
  notifications.update((list) => {
    if (list.some((existing) => existing.id === n.id)) {
      isNew = false;
      return list;
    }
    return [n, ...list];
  });
  if (isNew) unreadCount.update((c) => c + 1);
}

/** Marks one notification read — optimistic, with a rollback if the request fails. */
export async function markRead(id: string): Promise<void> {
  const target = get(notifications).find((n) => n.id === id);
  if (!target || target.read) return;
  notifications.update((list) => list.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n)));
  unreadCount.update((c) => Math.max(0, c - 1));
  try {
    await markNotificationRead(id);
  } catch {
    notifications.update((list) => list.map((n) => (n.id === id ? { ...n, read: false, readAt: undefined } : n)));
    unreadCount.update((c) => c + 1);
  }
}

/** Marks every currently-unread notification read — optimistic, with a rollback if the request fails. */
export async function markAllRead(): Promise<void> {
  const before = get(notifications);
  const wasUnreadCount = get(unreadCount);
  if (wasUnreadCount === 0) return;
  const readAt = new Date().toISOString();
  notifications.set(before.map((n) => (n.read ? n : { ...n, read: true, readAt })));
  unreadCount.set(0);
  try {
    await markAllNotificationsRead();
  } catch {
    notifications.set(before);
    unreadCount.set(wasUnreadCount);
  }
}

/** Called on logout, alongside the rest of workspace.ts's stores resetting. */
export function resetNotifications(): void {
  notifications.set([]);
  unreadCount.set(0);
  notificationsLoaded.set(false);
  hasMoreNotifications.set(false);
}
