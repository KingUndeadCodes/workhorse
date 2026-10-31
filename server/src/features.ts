import { createMiddleware } from 'hono/factory';
import type { Hono } from 'hono';
import type { WorkspaceFeatureFlags } from './domain';
import { workspaceRepo } from './container';

/** Shown to clients (and surfaced by the app) when a request hits a module an owner/admin switched off. */
export const FEATURE_OFF_ERROR = 'This feature is turned off for the workspace';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Whether `flag` is on for the workspace — the one check every gated code path (routes and background work) goes through. */
export async function isFeatureOn(flag: keyof WorkspaceFeatureFlags): Promise<boolean> {
  return (await workspaceRepo.getWorkspace()).featureFlags[flag];
}

/**
 * Rejects requests to a switched-off module with 403. With `mutatingOnly`, reads still pass —
 * the module's existing data is simply listed (the app hides it) but nothing can be created,
 * changed or triggered. Without it, every method is rejected.
 */
function requireFeature(flag: keyof WorkspaceFeatureFlags, mutatingOnly: boolean) {
  return createMiddleware(async (c, next) => {
    if (mutatingOnly && !MUTATING.has(c.req.method)) return next();
    if (!(await isFeatureOn(flag))) return c.json({ error: FEATURE_OFF_ERROR }, 403);
    return next();
  });
}

/**
 * Registers every module gate in one place, so what "off" blocks is readable at a glance. Call
 * after authentication and before the routers are mounted — Hono runs middleware in
 * registration order. Background work (agent runs, automation rules, webhook deliveries) is
 * gated separately in `EventEngine`, since it doesn't pass through a route.
 */
export function registerFeatureGates(app: Hono<any>): void {
  const gates: [keyof WorkspaceFeatureFlags, boolean, string[]][] = [
    ['agents', true, ['/api/agents', '/api/agents/*', '/api/agent-runs/*', '/api/issues/:id/agents', '/api/issues/:id/agents/*']],
    ['automations', true, ['/api/automations', '/api/automations/*']],
    ['webhooks', true, ['/api/webhooks', '/api/webhooks/*']],
    ['insights', false, ['/api/stats']],
    ['git', false, ['/api/git-connections', '/api/git-connections/*', '/api/git-providers', '/api/projects/:id/git-repo-link', '/api/issues/:id/branch']],
  ];
  for (const [flag, mutatingOnly, paths] of gates) {
    const gate = requireFeature(flag, mutatingOnly);
    for (const path of paths) app.use(path, gate);
  }
}
