import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { ActorRef, GitRepoLink, Project, User } from '../domain';
import { DEFAULT_FEATURE_FLAGS, PROJECT_COLORS } from '../domain';
import { requireNonGuest, type AuthVariables } from '../auth/middleware';
import { engine, gitProviders, gitRepoLinkRepo, planningRepo, projectRepo, workflowRepo, workspaceRepo } from '../container';
import { toGitRepoLinkPublic } from '../db/mappers';

/** CRUD for projects, plus a project's linked git repo definition. Branch creation lives in issues.ts, via a registered GitProvider. */
export const projectsRouter = new Hono<{ Variables: AuthVariables }>();

function actorFrom(user: User): ActorRef {
  return { kind: 'user', userId: user.id };
}

projectsRouter.get('/projects', async (c) => c.json(await projectRepo.listProjects()));

/** GET /api/git-providers — ids of every GitProvider actually registered in container.ts. Mirrors GET /api/agent-runtimes (routes/agents.ts); lets the client know upfront whether linking a repo can possibly succeed, instead of only finding out via a 400 after filling out the form. */
projectsRouter.get('/git-providers', (c) => c.json(gitProviders.list().map((p) => p.id)));

/**
 * POST /api/projects — creates a project. Body: `{ name, key, leadId?, color? }`. 400 if
 * name/key missing, 409 if the key is already taken (issue keys are `${key}-${suffix}`, so two
 * projects can't share a prefix). Reuses the workspace's one shared workflow (see
 * domain/workflow.ts — workflows aren't per-project) as the new project's `defaultWorkflowId`,
 * and seeds a board with one column per that workflow's statuses. `color` defaults to the
 * next unused entry in {@link PROJECT_COLORS} (cycling by how many projects already exist) if
 * the caller doesn't specify one. Emits `project.created` purely for webhook/automation
 * visibility — the DB write already happened via {@link projectRepo}, mirroring the
 * git-repo-link split (repo CRUD + event emitted alongside).
 */
projectsRouter.post('/projects', async (c) => {
  const body = await c.req.json<{ name: string; key: string; leadId?: string; color?: string }>();
  if (!body.name?.trim() || !body.key?.trim()) return c.json({ error: 'name and key are required' }, 400);
  const key = body.key.trim().toUpperCase();
  if (await projectRepo.getProjectByKey(key)) return c.json({ error: `Project key "${key}" is already in use` }, 409);

  const workspace = await workspaceRepo.getWorkspace();
  const workflow = await workflowRepo.getWorkflow();
  const existingCount = (await projectRepo.listProjects()).length;
  const project: Project = {
    id: `proj_${randomUUID()}`,
    workspaceId: workspace.id,
    key,
    name: body.name.trim(),
    leadId: body.leadId,
    defaultWorkflowId: workflow.id,
    color: body.color?.trim() || PROJECT_COLORS[existingCount % PROJECT_COLORS.length],
    featureFlags: DEFAULT_FEATURE_FLAGS,
    createdAt: new Date().toISOString(),
  };
  const created = await projectRepo.createProject(project);
  const board = await planningRepo.createBoardForProject(created.id, workspace.id, workflow.statuses);
  await engine.emitEvent({
    actor: actorFrom(c.get('user')),
    subject: { type: 'project', id: created.id },
    payload: { type: 'project.created', projectId: created.id },
  });
  return c.json({ project: created, board }, 201);
});

/**
 * PATCH /api/projects/:id — edits name/lead/color/featureFlags (or archives via `archivedAt`).
 * `key` is intentionally not editable — it's baked into every existing issue's key string.
 * Emits `project.updated` for webhook/automation/audit visibility, mirroring `issue.updated`
 * — the DB write already happened via {@link projectRepo}, same split as every other project
 * mutation in this file.
 */
projectsRouter.patch('/projects/:id', async (c) => {
  const id = c.req.param('id');
  const before = await projectRepo.getProjectById(id);
  if (!before) return c.json({ error: 'Not found' }, 404);

  const body = await c.req.json<Partial<Pick<Project, 'name' | 'leadId' | 'archivedAt' | 'color' | 'featureFlags'>>>();
  const updated = await projectRepo.updateProject(id, body);
  if (!updated) return c.json({ error: 'Not found' }, 404);

  const changes: Record<string, unknown> = {};
  for (const field of ['name', 'leadId', 'archivedAt', 'color', 'featureFlags'] as const) {
    if (!(field in body)) continue;
    if (JSON.stringify(before[field]) !== JSON.stringify(updated[field])) changes[field] = updated[field];
  }
  if (Object.keys(changes).length > 0) {
    await engine.emitEvent({
      actor: actorFrom(c.get('user')),
      subject: { type: 'project', id },
      payload: { type: 'project.updated', projectId: id, changes },
    });
  }

  return c.json(updated);
});

/** GET /api/projects/:id/git-repo-link -> GitRepoLinkPublic | null. Never includes the token. */
projectsRouter.get('/projects/:id/git-repo-link', async (c) => {
  const link = await gitRepoLinkRepo.getForProject(c.req.param('id'));
  return c.json(link ? toGitRepoLinkPublic(link) : null);
});

/**
 * POST /api/projects/:id/git-repo-link — links (or replaces) the project's git repo.
 * Body: `{ provider, owner, repo, defaultBranch?, token }`. `provider` must match the `id` of
 * a `GitProvider` registered in container.ts — this app ships no provider by default (see
 * services/GitProvider.ts), so until a deployment registers one, this always 400s with "No
 * GitProvider registered for ...". Once one is registered, this verifies the token can see the
 * repo and that `defaultBranch` exists before storing anything — 400 with the provider's
 * reason if not, so a typo or under-scoped token is caught here rather than surfacing later as
 * a 502 on first branch creation. Emits `project.gitRepoLinked` (never carrying the token).
 * Response is always the token-free `GitRepoLinkPublic`, even here.
 */
projectsRouter.post('/projects/:id/git-repo-link', async (c) => {
  const forbidden = await requireNonGuest(c, 'manage git repo links');
  if (forbidden) return c.json({ error: forbidden }, 403);
  const projectId = c.req.param('id');
  const body = await c.req.json<{ provider: string; owner: string; repo: string; defaultBranch?: string; token: string }>();
  if (!body.provider?.trim() || !body.owner?.trim() || !body.repo?.trim() || !body.token?.trim()) {
    return c.json({ error: 'provider, owner, repo, and token are required' }, 400);
  }

  const provider = body.provider.trim();
  const owner = body.owner.trim();
  const repo = body.repo.trim();
  const defaultBranch = body.defaultBranch?.trim() || 'main';
  const token = body.token.trim();

  try {
    await gitProviders.resolve(provider).verifyAccess({ owner, repo, token, branch: defaultBranch });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  const link: GitRepoLink = {
    id: `gitlink_${randomUUID()}`,
    projectId,
    provider,
    owner,
    repo,
    defaultBranch,
    token,
    createdAt: new Date().toISOString(),
    createdBy: c.get('user').id,
  };
  const created = await gitRepoLinkRepo.create(link);
  await engine.emitEvent({
    actor: actorFrom(c.get('user')),
    subject: { type: 'project', id: projectId },
    payload: { type: 'project.gitRepoLinked', projectId, gitRepoLinkId: created.id, owner: created.owner, repo: created.repo },
  });
  return c.json(toGitRepoLinkPublic(created), 201);
});

/** DELETE /api/projects/:id/git-repo-link — 404 if none exists, else unlinks and emits `project.gitRepoUnlinked`. */
projectsRouter.delete('/projects/:id/git-repo-link', async (c) => {
  const forbidden = await requireNonGuest(c, 'manage git repo links');
  if (forbidden) return c.json({ error: forbidden }, 403);
  const projectId = c.req.param('id');
  const existing = await gitRepoLinkRepo.getForProject(projectId);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await gitRepoLinkRepo.delete(projectId);
  await engine.emitEvent({
    actor: actorFrom(c.get('user')),
    subject: { type: 'project', id: projectId },
    payload: { type: 'project.gitRepoUnlinked', projectId, gitRepoLinkId: existing.id },
  });
  return c.json({ ok: true });
});
