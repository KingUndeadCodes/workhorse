import type { BranchId, GitRepoLinkId, IssueId, ProjectId, UserId } from './ids';

/**
 * A credential for a git host — a pasted personal access token, or a GitHub OAuth App access
 * token from an authorization-code exchange. Lives on a {@link UserGitConnection} (one per
 * person), never on a project: a repo link only says *which* repo, and whoever an agent is
 * acting for supplies the credential at the moment it acts.
 */
export type GitAuth = { kind: 'token'; token: string } | { kind: 'oauth'; accessToken: string };

/**
 * One person's connection to a git host (their own GitHub account). Plaintext secret on this
 * type, encrypted at rest by `UserGitConnectionRepository` (server/src/crypto/tokenCipher.ts).
 * Never returned to the client; see {@link UserGitConnectionPublic}.
 */
export interface UserGitConnection {
  userId: UserId;
  provider: string;
  auth: GitAuth;
  /** The host-side account name (e.g. the GitHub login) — what the UI shows as "connected as". */
  accountLogin?: string;
  createdAt: string;
}

export type UserGitConnectionPublic = Omit<UserGitConnection, 'auth'> & { authKind: GitAuth['kind'] };

/**
 * A project's link to an external git host. One per project — "latest wins": linking a new
 * repo for a project that already has one replaces it (same simplification the rest of this
 * schema uses; see schema.ts's third-normal-form disclaimer). Modeled after
 * WebhookSubscription: a "definition" row, not part of the event-sourced log. Holds no secret —
 * credentials belong to people, see {@link UserGitConnection}.
 *
 * `provider` is an open string, not a literal union — this app ships no built-in git host, only
 * the harness (`server/src/services/GitProvider.ts`'s `GitProvider` interface + registry).
 * It's an id that must match a `GitProvider.id` registered in `container.ts` for linking to
 * actually work; which ids are valid is entirely up to whatever `GitProvider`s a deployment
 * registers (`'github'`, `'gitlab'`, `'my-internal-host'`, ...).
 */
export interface GitRepoLink {
  id: GitRepoLinkId;
  projectId: ProjectId;
  provider: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  createdAt: string;
  createdBy: UserId;
}

/**
 * A branch created on the linked repo for one issue. An issue has at most one active branch
 * at a time — deleting the record just clears the slot so a new one can be created later
 * (e.g. after the first branch was merged); no history is kept, matching the "definitions,
 * not audit log" spirit of this side table (same as Attachment).
 */
export interface Branch {
  id: BranchId;
  issueId: IssueId;
  gitRepoLinkId: GitRepoLinkId;
  name: string;
  url: string;
  createdAt: string;
  createdBy: UserId;
}

/**
 * Shared by the server (the actual branch name a `GitProvider` creates) and the client (the
 * editable suggestion shown before submitting) so the two can never drift — this lives here,
 * not alongside any provider implementation, specifically so the frontend can import it
 * without pulling in a provider's own dependencies.
 * e.g. `slugifyBranchName('PRJ-142', 'Fix login redirect loop')` -> `'issue/PRJ-142-fix-login-redirect-loop'`.
 */
export function slugifyBranchName(issueKey: string, title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `issue/${issueKey}-${slug}`;
}
