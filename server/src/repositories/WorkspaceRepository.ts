import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToWorkspace, rowToWorkspaceInvite, rowToWorkspaceMember } from '../db/mappers';
import type { Workspace, WorkspaceInvite, WorkspaceMember, WorkspaceRole } from '../domain';

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

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await this.db.deleteFrom('workspace_members').where('workspace_id', '=', workspaceId).where('user_id', '=', userId).execute();
    persistState();
  }

  async listInvites(workspaceId: string): Promise<WorkspaceInvite[]> {
    return (await this.db.selectFrom('workspace_invites').selectAll().where('workspace_id', '=', workspaceId).execute()).map(rowToWorkspaceInvite);
  }

  async getInviteByEmail(email: string): Promise<WorkspaceInvite | undefined> {
    const row = await this.db.selectFrom('workspace_invites').selectAll().where('email', '=', email).executeTakeFirst();
    return row ? rowToWorkspaceInvite(row) : undefined;
  }

  async createInvite(invite: WorkspaceInvite): Promise<WorkspaceInvite> {
    await this.db
      .insertInto('workspace_invites')
      .values({
        id: invite.id,
        workspace_id: invite.workspaceId,
        email: invite.email,
        role: invite.role,
        invited_by: invite.invitedBy,
        created_at: invite.createdAt,
      })
      .execute();
    persistState();
    return invite;
  }

  /** Consumed the moment a matching signup succeeds (see routes/auth.ts) — an invite is single-use, not a standing allowlist entry. */
  async deleteInviteByEmail(email: string): Promise<void> {
    await this.db.deleteFrom('workspace_invites').where('email', '=', email).execute();
    persistState();
  }

  async deleteInvite(id: string): Promise<void> {
    await this.db.deleteFrom('workspace_invites').where('id', '=', id).execute();
    persistState();
  }

  async hasAnyMember(): Promise<boolean> {
    return (await this.db.selectFrom('workspace_members').select('user_id').limit(1).execute()).length > 0;
  }

  async hasOwner(): Promise<boolean> {
    return (await this.db.selectFrom('workspace_members').select('user_id').where('role', '=', 'owner').limit(1).execute()).length > 0;
  }
}
