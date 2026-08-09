import type { UserId, WorkspaceId } from './ids';

/**
 * Distinguishes a human account from an AI agent's.
 *
 * 'agent' users are backed by an {@link Agent} record (agent.ts) sharing the same id —
 * that's the whole trick that makes agents assignable, @mentionable, and watchable for
 * free: every place a {@link UserId} is already accepted (`Issue.assigneeId`,
 * `Comment.authorId`, `Watcher`) just works, with zero special-casing for the fact that a
 * "user" might be an AI.
 */
export type UserKind = 'human' | 'agent';

/** An account in a workspace — either a human or an AI agent (see {@link UserKind}). */
export interface User {
  id: UserId;
  kind: UserKind;
  email: string;
  displayName: string;
  avatarUrl?: string;
  status: 'active' | 'invited' | 'deactivated';
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** Coarse workspace-wide permission level. */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'guest';

/** A {@link User}'s membership in a specific workspace, and their role within it. */
export interface WorkspaceMember {
  workspaceId: WorkspaceId;
  userId: UserId;
  role: WorkspaceRole;
  joinedAt: string;
}
