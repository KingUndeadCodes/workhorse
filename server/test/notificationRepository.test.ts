import { describe, expect, it } from 'vitest';
import { NotificationRepository } from '../src/repositories/NotificationRepository';
import type { Notification } from '../src/domain';

function makeNotification(overrides: Partial<Notification> & { id: string; recipientUserId: string }): Notification {
  return {
    workspaceId: 'ws_test',
    eventId: `evt_${overrides.id}`,
    issueId: 'issue_test',
    kind: 'assigned',
    read: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('NotificationRepository', () => {
  async function repo() {
    const { db } = await import('../src/db/core');
    return new NotificationRepository(db);
  }

  it('lists a user notifications most-recent-first, with correct hasMore at the page boundary', async () => {
    const notificationRepo = await repo();
    for (let i = 0; i < 3; i++) {
      await notificationRepo.create(makeNotification({ id: `n${i}`, recipientUserId: 'u_alice', createdAt: new Date(2026, 0, i + 1).toISOString() }));
    }

    const firstPage = await notificationRepo.listForUser('u_alice', 2, 0);
    expect(firstPage.notifications.map((n) => n.id)).toEqual(['n2', 'n1']);
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await notificationRepo.listForUser('u_alice', 2, 2);
    expect(secondPage.notifications.map((n) => n.id)).toEqual(['n0']);
    expect(secondPage.hasMore).toBe(false);
  });

  it('counts only unread notifications for that recipient', async () => {
    const notificationRepo = await repo();
    await notificationRepo.create(makeNotification({ id: 'n1', recipientUserId: 'u_bob', read: false }));
    await notificationRepo.create(makeNotification({ id: 'n2', recipientUserId: 'u_bob', read: true }));
    await notificationRepo.create(makeNotification({ id: 'n3', recipientUserId: 'u_carol', read: false }));

    expect(await notificationRepo.countUnread('u_bob')).toBe(1);
  });

  it('markRead is scoped to the recipient and idempotent', async () => {
    const notificationRepo = await repo();
    await notificationRepo.create(makeNotification({ id: 'n1', recipientUserId: 'u_bob' }));

    const wrongUser = await notificationRepo.markRead('n1', 'u_mallory');
    expect(wrongUser).toBeUndefined();
    expect(await notificationRepo.countUnread('u_bob')).toBe(1);

    const marked = await notificationRepo.markRead('n1', 'u_bob');
    expect(marked?.read).toBe(true);
    expect(await notificationRepo.countUnread('u_bob')).toBe(0);

    const markedAgain = await notificationRepo.markRead('n1', 'u_bob');
    expect(markedAgain?.read).toBe(true);
  });

  it('markAllRead clears only that recipient unread notifications', async () => {
    const notificationRepo = await repo();
    await notificationRepo.create(makeNotification({ id: 'n1', recipientUserId: 'u_bob' }));
    await notificationRepo.create(makeNotification({ id: 'n2', recipientUserId: 'u_bob' }));
    await notificationRepo.create(makeNotification({ id: 'n3', recipientUserId: 'u_carol' }));

    await notificationRepo.markAllRead('u_bob');

    expect(await notificationRepo.countUnread('u_bob')).toBe(0);
    expect(await notificationRepo.countUnread('u_carol')).toBe(1);
  });
});
