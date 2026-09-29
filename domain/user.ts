import type { UserId, WorkspaceId, WorkspaceInviteId } from './ids';

/**
 * Distinguishes a human account from an AI agent's.
 *
 * 'agent' users are backed by an {@link Agent} record (agent.ts) sharing the same id —
 * that's the whole trick that makes agents assignable and @mentionable for free: every
 * place a {@link UserId} is already accepted (`Issue.assigneeIds`, `Comment.authorId`)
 * just works, with zero special-casing for the fact that a "user" might be an AI.
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

/**
 * A pre-approval for someone who hasn't signed up yet: an owner/admin registers an email and
 * the role it should get, and `POST /auth/signup` (routes/auth.ts) checks incoming signups
 * against this table instead of always defaulting to `'member'`. There is no email sent by
 * this app — the admin shares the signup link themselves; this is purely an allowlist entry,
 * consumed (deleted) the moment a matching signup succeeds.
 */
export interface WorkspaceInvite {
  id: WorkspaceInviteId;
  workspaceId: WorkspaceId;
  /** Normalized lowercase, same convention as `User.email`. */
  email: string;
  role: WorkspaceRole;
  invitedBy: UserId;
  createdAt: string;
}
