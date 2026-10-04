import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToProject } from '../db/mappers';
import type { Project } from '../domain';

/** CRUD for projects. `key` is immutable once created — it's baked into every issue's key string (`${key}-${suffix}`), so it's deliberately excluded from {@link updateProject}. */
export class ProjectRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async listProjects(): Promise<Project[]> {
    return (await this.db.selectFrom('project').selectAll().execute()).map(rowToProject);
  }

  async getProjectById(id: string): Promise<Project | undefined> {
    const row = await this.db.selectFrom('project').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? rowToProject(row) : undefined;
  }

  async getProjectByKey(key: string): Promise<Project | undefined> {
    const row = await this.db.selectFrom('project').selectAll().where('key', '=', key).executeTakeFirst();
    return row ? rowToProject(row) : undefined;
  }

  async createProject(project: Project): Promise<Project> {
    await this.db
      .insertInto('project')
      .values({
        id: project.id,
        workspace_id: project.workspaceId,
        key: project.key,
        name: project.name,
        lead_id: project.leadId ?? null,
        default_workflow_id: project.defaultWorkflowId,
        color: project.color,
        feature_flags: JSON.stringify(project.featureFlags),
        created_at: project.createdAt,
        archived_at: project.archivedAt ?? null,
      })
      .execute();
    persistState();
    return project;
  }

  async updateProject(id: string, changes: Partial<Pick<Project, 'name' | 'leadId' | 'archivedAt' | 'color' | 'featureFlags'>>): Promise<Project | undefined> {
    const existing = await this.getProjectById(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...changes };
    await this.db
      .updateTable('project')
      .set({ name: merged.name, lead_id: merged.leadId ?? null, archived_at: merged.archivedAt ?? null, color: merged.color, feature_flags: JSON.stringify(merged.featureFlags) })
      .where('id', '=', id)
      .execute();
    persistState();
    return merged;
  }

  /**
   * The next `${projectKey}-${n}` issue key for a project: a per-project counter, not a random suffix (a
   * random 6-hex suffix collides by the birthday bound around a few thousand issues, silently). Runs in a
   * transaction so concurrent creations get distinct numbers, and skips any number whose key already exists —
   * older databases hold random-suffix keys that could look like a number — so it never hands out a duplicate.
   */
  async allocateIssueKey(projectId: string, projectKey: string): Promise<string> {
    const key = await this.db.transaction().execute(async (trx) => {
      const project = await trx.selectFrom('project').select('next_issue_number').where('id', '=', projectId).executeTakeFirst();
      let n = project?.next_issue_number;
      if (!n) {
        const { count } = await trx.selectFrom('issues').select((eb) => eb.fn.countAll<number>().as('count')).where('project_id', '=', projectId).executeTakeFirstOrThrow();
        n = Number(count) + 1;
      }
      while (await trx.selectFrom('issues').select('id').where('key', '=', `${projectKey}-${n}`).executeTakeFirst()) n++;
      await trx.updateTable('project').set({ next_issue_number: n + 1 }).where('id', '=', projectId).execute();
      return `${projectKey}-${n}`;
    });
    persistState();
    return key;
  }
}
