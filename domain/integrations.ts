import type { BranchId, GitRepoLinkId, IssueId, ProjectId, UserId } from './ids';

/**
 * A project's link to an external git host. One per project — "latest wins": linking a new
 * repo for a project that already has one replaces it (same simplification the rest of this
 * schema uses; see schema.ts's third-normal-form disclaimer). Modeled after
 * WebhookSubscription: a plaintext "definition" row, not part of the event-sourced log.
 *
 * `provider` is a literal union of one today (`'github'`) so a second host (GitLab,
 * Bitbucket) can be added later by widening the union and adding a second implementation
 * behind the same shape `GitHubService` exposes, without reshaping this type or its schema.
 */
export interface GitRepoLink {
  id: GitRepoLinkId;
  projectId: ProjectId;
  provider: 'github';
  owner: string;
  repo: string;
  defaultBranch: string;
  /** Personal access token, plaintext — same no-encryption-at-rest convention as WebhookSubscription.secret. Never returned to the client; see GitRepoLinkPublic. */
  token: string;
  createdAt: string;
  createdBy: UserId;
}

/** What the API ever returns for a GitRepoLink — `token` is deliberately omitted, write-only, even on creation. */
export type GitRepoLinkPublic = Omit<GitRepoLink, 'token'>;

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
 * Shared by the server (the actual branch name it creates on GitHub) and the client (the
 * editable suggestion shown before submitting) so the two can never drift — this lives here,
 * not in server/src/services/GitHubService.ts, specifically so the frontend can import it
 * without pulling in that file's `octokit` dependency.
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
