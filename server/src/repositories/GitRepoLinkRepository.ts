import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToGitRepoLink } from '../db/mappers';
import type { GitRepoLink } from '../domain';

/** CRUD for per-project git repo link definitions. One per project — "latest wins": {@link create} replaces any existing link for that project. */
export class GitRepoLinkRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async getForProject(projectId: string): Promise<GitRepoLink | undefined> {
    const row = await this.db.selectFrom('git_repo_links').selectAll().where('project_id', '=', projectId).executeTakeFirst();
    return row ? rowToGitRepoLink(row) : undefined;
  }

  async create(link: GitRepoLink): Promise<GitRepoLink> {
    // Insert-then-delete-old, not delete-then-insert: if the insert throws (e.g. a transient
    // DB error), the project keeps its previous link instead of silently ending up with none.
    // There's no transaction wrapping these two statements — no precedent for Kysely
    // transactions elsewhere against this sql.js/kysely-wasm setup — so this ordering is what
    // keeps a mid-failure outcome "still has a repo" rather than "lost its repo".
    await this.db
      .insertInto('git_repo_links')
      .values({
        id: link.id,
        project_id: link.projectId,
        provider: link.provider,
        owner: link.owner,
        repo: link.repo,
        default_branch: link.defaultBranch,
        token: link.token,
        created_at: link.createdAt,
        created_by: link.createdBy,
      })
      .execute();
    await this.db.deleteFrom('git_repo_links').where('project_id', '=', link.projectId).where('id', '!=', link.id).execute();
    persistState();
    return link;
  }

  async delete(projectId: string): Promise<void> {
    await this.db.deleteFrom('git_repo_links').where('project_id', '=', projectId).execute();
    persistState();
  }
}
