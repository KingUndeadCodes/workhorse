import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToWorkspace, rowToWorkspaceMember } from '../db/mappers';
import type { Workspace, WorkspaceMember, WorkspaceRole } from '../domain';

/** Reads/writes for the single workspace this prototype serves, plus workspace membership/roles. Project CRUD lives in {@link ProjectRepository} — a workspace can hold many projects. */
export class WorkspaceRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async getWorkspace(): Promise<Workspace> {
    return rowToWorkspace((await this.db.selectFrom('workspace').selectAll().executeTakeFirst())!);
  }

  async listMembers(): Promise<WorkspaceMember[]> {
    return (await this.db.selectFrom('workspace_members').selectAll().execute()).map(rowToWorkspaceMember);
  }

  async getMember(userId: string): Promise<WorkspaceMember | undefined> {
    const row = await this.db.selectFrom('workspace_members').selectAll().where('user_id', '=', userId).executeTakeFirst();
    return row ? rowToWorkspaceMember(row) : undefined;
  }

  async addMember(workspaceId: string, userId: string, role: WorkspaceRole, joinedAt: string): Promise<void> {
    await this.db.insertInto('workspace_members').values({ workspace_id: workspaceId, user_id: userId, role, joined_at: joinedAt }).execute();
    persistState();
  }

  async updateMemberRole(workspaceId: string, userId: string, role: WorkspaceRole): Promise<WorkspaceMember | undefined> {
    await this.db.updateTable('workspace_members').set({ role }).where('workspace_id', '=', workspaceId).where('user_id', '=', userId).execute();
    persistState();
    return this.getMember(userId);
  }

  async hasAnyMember(): Promise<boolean> {
    return (await this.db.selectFrom('workspace_members').select('user_id').limit(1).execute()).length > 0;
  }

  async hasOwner(): Promise<boolean> {
    return (await this.db.selectFrom('workspace_members').select('user_id').where('role', '=', 'owner').limit(1).execute()).length > 0;
  }
}
