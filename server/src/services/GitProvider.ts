/**
 * The seam every git host (GitHub, GitLab, Bitbucket, a self-hosted server, ...) implements.
 * This app ships no concrete implementation — only this interface and the registry below —
 * so it stays provider-agnostic by construction: routes/projects.ts and routes/issues.ts talk
 * only to whatever `GitProvider` a `GitRepoLink.provider` resolves to via
 * `GitProviderRegistry`, never to a concrete class. Enabling real git linking is "implement
 * this interface for the host you want and register an instance in container.ts" — no route
 * changes required.
 *
 * Grown once already, deliberately, for agent file access (`readFile`/`writeFile` below) —
 * see domain/automation.ts's `readRepoFile`/`writeRepoFile` actions, the actual callers. Grow
 * it again only when an implementation and a caller both need a new method; don't pre-build
 * methods (repo listing, PR status, webhooks) nothing calls yet.
 */
export interface GitProvider {
  readonly id: string;

  /** Confirms a token can see the given repo and branch. Throws a message safe to show the user directly. */
  verifyAccess(opts: { owner: string; repo: string; token: string; branch: string }): Promise<void>;

  /** Creates `newBranchName` on `repo`, branched off the head of `fromBranch`. Throws on any provider-side failure. */
  createBranch(opts: { owner: string; repo: string; token: string; fromBranch: string; newBranchName: string }): Promise<{ url: string }>;

  /** Reads one file's content from `branch`. Throws if the path doesn't exist there. */
  readFile(opts: { owner: string; repo: string; token: string; branch: string; path: string }): Promise<{ content: string }>;

  /**
   * Creates or overwrites one file, committed directly to `branch` — never to a local working
   * tree, never interactively. Implementations must not require (or leave behind) a checkout
   * of `branch` anywhere a human might be using it themselves.
   */
  writeFile(opts: {
    owner: string;
    repo: string;
    token: string;
    branch: string;
    path: string;
    content: string;
    commitMessage: string;
  }): Promise<{ url: string }>;
}

/**
 * Looks up a registered `GitProvider` by id. Deliberately not built on a shared generic
 * registry base with `AgentRuntimeRegistry` (services/AgentRuntime.ts) — the two have nothing
 * in common beyond "look something up by a string id in a Map," which isn't enough shared
 * behavior to justify a common ancestor type. Each stays a plain, independent, ~10-line class.
 */
export class GitProviderRegistry {
  private readonly providers = new Map<string, GitProvider>();

  register(provider: GitProvider): void {
    this.providers.set(provider.id, provider);
  }

  resolve(id: string): GitProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`No git provider registered for "${id}"`);
    return provider;
  }

  list(): GitProvider[] {
    return [...this.providers.values()];
  }
}
