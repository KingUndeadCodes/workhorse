import type { UserGitConnectionRepository } from '../repositories/UserGitConnectionRepository';
import type { GitAuth, GitRepoLink } from '../domain';

/**
 * Decides whose git credential an action uses. Commits are made by proxy: the credential is
 * always a real person's own, never one stored on the project and never the agent's (agents have
 * no git identity). Callers pass the people the action is on behalf of, most accountable first;
 * the first one with a connection wins, and the link's creator is the last resort.
 */
export class GitAuthResolver {
  constructor(private readonly connections: UserGitConnectionRepository) {}

  async resolve(link: GitRepoLink, candidateUserIds: (string | undefined)[]): Promise<GitAuth> {
    // `local` talks to the server's own git binary — nothing to authenticate with.
    if (link.provider === 'local') return { kind: 'token', token: '' };
    for (const userId of [...candidateUserIds, link.createdBy]) {
      if (!userId) continue;
      const connection = await this.connections.get(userId, link.provider);
      if (connection) return connection.auth;
    }
    throw new Error(`No ${link.provider} account is connected for this action — connect yours under Settings → Git.`);
  }
}
