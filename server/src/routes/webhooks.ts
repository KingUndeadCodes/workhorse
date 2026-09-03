import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { EventType, WebhookSubscription } from '../domain';
import { requireNonGuest, type AuthVariables } from '../auth/middleware';
import { webhookDeliveryRepo, webhookRepo, workspaceRepo } from '../container';
import { toWebhookPublic } from '../db/mappers';

const DEFAULT_DELIVERIES_LIMIT = 20;
const MAX_DELIVERIES_LIMIT = 100;

/** CRUD for outbound webhook subscription definitions. Delivery itself lives in {@link EventEngine}. */
export const webhooksRouter = new Hono<{ Variables: AuthVariables }>();

webhooksRouter.get('/webhooks', async (c) => c.json((await webhookRepo.list()).map(toWebhookPublic)));

/** GET /api/webhooks/:id/deliveries?limit=&offset= — this hook's delivery attempts, most recent first. Unguarded, same as GET /webhooks. */
webhooksRouter.get('/webhooks/:id/deliveries', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? DEFAULT_DELIVERIES_LIMIT), 1), MAX_DELIVERIES_LIMIT);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
  const { deliveries, hasMore } = await webhookDeliveryRepo.listForWebhook(c.req.param('id'), limit, offset);
  return c.json({ deliveries, hasMore });
});

webhooksRouter.post('/webhooks', async (c) => {
  const forbidden = await requireNonGuest(c, 'manage webhooks');
  if (forbidden) return c.json({ error: forbidden }, 403);
  const body = await c.req.json<{ targetUrl: string; eventFilter: EventType[] | '*' }>();
  if (!body.targetUrl?.trim()) return c.json({ error: 'targetUrl is required' }, 400);
  const hook: WebhookSubscription = {
    id: `hook_${randomUUID()}`,
    workspaceId: (await workspaceRepo.getWorkspace()).id,
    targetUrl: body.targetUrl.trim(),
    // Generated server-side and never echoed back in list responses (see toWebhookPublic);
    // returned here once on creation since there's no separate "reveal secret" flow in this prototype.
    secret: randomBytes(24).toString('hex'),
    eventFilter: body.eventFilter,
    enabled: true,
    createdBy: c.get('user').id,
  };
  return c.json(await webhookRepo.create(hook), 201);
});

webhooksRouter.patch('/webhooks/:id', async (c) => {
  const forbidden = await requireNonGuest(c, 'manage webhooks');
  if (forbidden) return c.json({ error: forbidden }, 403);
  const body = await c.req.json<Partial<Pick<WebhookSubscription, 'targetUrl' | 'eventFilter' | 'enabled'>>>();
  const updated = await webhookRepo.update(c.req.param('id'), body);
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(toWebhookPublic(updated));
});

webhooksRouter.delete('/webhooks/:id', async (c) => {
  const forbidden = await requireNonGuest(c, 'manage webhooks');
  if (forbidden) return c.json({ error: forbidden }, 403);
  const id = c.req.param('id');
  await webhookRepo.delete(id);
  await webhookDeliveryRepo.deleteForWebhook(id);
  return c.json({ ok: true });
});
