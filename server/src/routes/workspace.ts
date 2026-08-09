import { Hono } from 'hono';
import type { WorkspaceRole } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { persistState, run, stateDb } from '../db/core';
import { getWorkspace, getWorkspaceMember, listWorkspaceMembers } from '../queries';

/** Workspace membership — who's in this workspace and what role they hold. No invite flow yet; membership is assigned at signup (see auth/repository.ts). */
export const workspaceRouter = new Hono<{ Variables: AuthVariables }>();

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'guest'];

workspaceRouter.get('/workspace-members', async (c) => c.json(await listWorkspaceMembers()));

/** PATCH /api/workspace-members/:userId — change a member's role. Only owners/admins may do this. */
workspaceRouter.patch('/workspace-members/:userId', async (c) => {
  const targetId = c.req.param('userId');
  const caller = await getWorkspaceMember(c.get('user').id);
  if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) {
    return c.json({ error: 'Only workspace owners/admins can change roles' }, 403);
  }
  const target = await getWorkspaceMember(targetId);
  if (!target) return c.json({ error: 'Not a member of this workspace' }, 404);

  const body = await c.req.json<{ role: WorkspaceRole }>();
  if (!ROLES.includes(body.role)) return c.json({ error: 'Invalid role' }, 400);

  run(stateDb, `UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?`, [body.role, (await getWorkspace()).id, targetId]);
  persistState();
  return c.json(await getWorkspaceMember(targetId));
});
