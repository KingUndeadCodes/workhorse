import { Hono } from 'hono';
import type { WorkspaceRole } from '../domain';
import type { AuthVariables } from '../auth/middleware';
import { workspaceRepo } from '../container';

/** Workspace membership — who's in this workspace and what role they hold. No invite flow yet; membership is assigned at signup (see routes/auth.ts). */
export const workspaceRouter = new Hono<{ Variables: AuthVariables }>();

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member', 'guest'];

workspaceRouter.get('/workspace-members', async (c) => c.json(await workspaceRepo.listMembers()));

/** PATCH /api/workspace-members/:userId — change a member's role. Only owners/admins may do this. */
workspaceRouter.patch('/workspace-members/:userId', async (c) => {
  const targetId = c.req.param('userId');
  const caller = await workspaceRepo.getMember(c.get('user').id);
  if (!caller || (caller.role !== 'owner' && caller.role !== 'admin')) {
    return c.json({ error: 'Only workspace owners/admins can change roles' }, 403);
  }
  const target = await workspaceRepo.getMember(targetId);
  if (!target) return c.json({ error: 'Not a member of this workspace' }, 404);

  const body = await c.req.json<{ role: WorkspaceRole }>();
  if (!ROLES.includes(body.role)) return c.json({ error: 'Invalid role' }, 400);

  const workspace = await workspaceRepo.getWorkspace();
  return c.json(await workspaceRepo.updateMemberRole(workspace.id, targetId, body.role));
});
