import type { AgentRuntime } from '../services/AgentRuntime';
import type { GitProvider } from '../services/GitProvider';

/**
 * What a plugin gets to touch — a small facade over the real registries in container.ts, not
 * the registries themselves. A plugin registers providers/runtimes through this without
 * importing (or knowing anything about) container.ts's other singletons — repositories, the
 * event engine, the database. This is the entire surface a third party needs to extend
 * Workhorse without forking it: implement `GitProvider` or `AgentRuntime`, export a
 * `WorkhorsePlugin` that registers it through this context, drop the file in `plugins/`, and
 * it's live on the next boot. No core repo edit, no rebuild of `server/`.
 */
export interface PluginContext {
  registerGitProvider(provider: GitProvider): void;
  registerAgentRuntime(runtime: AgentRuntime): void;
}

/** What a plugin module must default-export. `id` is only used in boot logs, to say what loaded and from where. */
export interface WorkhorsePlugin {
  id: string;
  register(ctx: PluginContext): void | Promise<void>;
}
