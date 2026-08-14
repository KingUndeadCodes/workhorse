import { Octokit } from 'octokit';

/**
 * Thin wrapper around the two GitHub REST calls this feature needs — look up a branch's
 * head SHA, then create a new ref from it. No local git operations, no clone/checkout.
 *
 * A new `Octokit` is constructed per call rather than cached like the lazy Anthropic()
 * singleton, since each call needs a different project's PAT — construction is cheap.
 *
 * Method names/params are kept provider-neutral (not "GitHub"-specific) so a second host
 * (GitLab, Bitbucket) can implement the same shape later behind a small provider interface —
 * see the "Future extensibility" note in the linked plan. Nothing beyond that is built now.
 */
export class GitHubService {
  async createBranch(opts: { owner: string; repo: string; token: string; fromBranch: string; newBranchName: string }): Promise<{ url: string }> {
    const octokit = new Octokit({ auth: opts.token });
    const { data: ref } = await octokit.rest.git.getRef({ owner: opts.owner, repo: opts.repo, ref: `heads/${opts.fromBranch}` });
    await octokit.rest.git.createRef({ owner: opts.owner, repo: opts.repo, ref: `refs/heads/${opts.newBranchName}`, sha: ref.object.sha });
    return { url: `https://github.com/${opts.owner}/${opts.repo}/tree/${encodeURIComponent(opts.newBranchName)}` };
  }
}

// `slugifyBranchName` moved to domain/integrations.ts, shared verbatim with the frontend's
// branch-name suggestion instead of being duplicated — re-exported here since issues.ts
// already imported it from this file.
export { slugifyBranchName } from '../domain';
