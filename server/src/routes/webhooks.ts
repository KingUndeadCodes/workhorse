import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { EventType, WebhookSubscription } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { persistState, run, stateDb } from '../db/core';
import { webhookParams } from '../db/mappers';
import { getWorkspace, listWebhookSubscriptions } from '../queries';

/** CRUD for outbound webhook subscription definitions. Delivery itself lives in engine.ts. */
export const webhooksRouter = new Hono<{ Variables: AuthVariables }>();

webhooksRouter.get('/webhooks', async (c) => c.json(await listWebhookSubscriptions()));

webhooksRouter.post('/webhooks', async (c) => {
  const body = await c.req.json<{ targetUrl: string; eventFilter: EventType[] | '*' }>();
  if (!body.targetUrl?.trim()) return c.json({ error: 'targetUrl is required' }, 400);
  const hook: WebhookSubscription = {
    id: `hook_${randomUUID()}`,
    workspaceId: (await getWorkspace()).id,
    targetUrl: body.targetUrl.trim(),
    // Generated server-side and never echoed back in list responses in a real system;
    // returned here once on creation since there's no separate "reveal secret" flow in this prototype.
    secret: randomBytes(24).toString('hex'),
    eventFilter: body.eventFilter,
    enabled: true,
    createdBy: c.get('user').id,
  };
  run(stateDb, `INSERT INTO webhook_subscriptions (id, workspace_id, target_url, secret, event_filter, enabled, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`, webhookParams(hook));
  persistState();
  return c.json(hook, 201);
});

webhooksRouter.patch('/webhooks/:id', async (c) => {
  const id = c.req.param('id');
  const existing = (await listWebhookSubscriptions()).find((h) => h.id === id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const body = await c.req.json<Partial<Pick<WebhookSubscription, 'targetUrl' | 'eventFilter' | 'enabled'>>>();
  const merged = { ...existing, ...body };
  run(stateDb, `UPDATE webhook_subscriptions SET target_url = ?, event_filter = ?, enabled = ? WHERE id = ?`, [merged.targetUrl, JSON.stringify(merged.eventFilter), merged.enabled ? 1 : 0, id]);
  persistState();
  return c.json(merged);
});

webhooksRouter.delete('/webhooks/:id', (c) => {
  run(stateDb, `DELETE FROM webhook_subscriptions WHERE id = ?`, [c.req.param('id')]);
  persistState();
  return c.json({ ok: true });
});
