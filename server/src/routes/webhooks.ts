import { randomBytes, randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { EventType, WebhookSubscription } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { webhookRepo, workspaceRepo } from '../container';

/** CRUD for outbound webhook subscription definitions. Delivery itself lives in {@link EventEngine}. */
export const webhooksRouter = new Hono<{ Variables: AuthVariables }>();

webhooksRouter.get('/webhooks', async (c) => c.json(await webhookRepo.list()));

webhooksRouter.post('/webhooks', async (c) => {
  const body = await c.req.json<{ targetUrl: string; eventFilter: EventType[] | '*' }>();
  if (!body.targetUrl?.trim()) return c.json({ error: 'targetUrl is required' }, 400);
  const hook: WebhookSubscription = {
    id: `hook_${randomUUID()}`,
    workspaceId: (await workspaceRepo.getWorkspace()).id,
    targetUrl: body.targetUrl.trim(),
    // Generated server-side and never echoed back in list responses in a real system;
    // returned here once on creation since there's no separate "reveal secret" flow in this prototype.
    secret: randomBytes(24).toString('hex'),
    eventFilter: body.eventFilter,
    enabled: true,
    createdBy: c.get('user').id,
  };
  return c.json(await webhookRepo.create(hook), 201);
});

webhooksRouter.patch('/webhooks/:id', async (c) => {
  const body = await c.req.json<Partial<Pick<WebhookSubscription, 'targetUrl' | 'eventFilter' | 'enabled'>>>();
  const updated = await webhookRepo.update(c.req.param('id'), body);
  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

webhooksRouter.delete('/webhooks/:id', async (c) => {
  await webhookRepo.delete(c.req.param('id'));
  return c.json({ ok: true });
});
