/** One tool an agent may call this turn — provider-neutral, so any `AgentRuntime` implementation can build this from its own tool-calling format without a shared SDK. */
export interface AgentRuntimeTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[] };
}

/** One turn's decision: which tools (if any) the model chose to call, plus any free text it produced alongside them. */
export interface AgentRuntimeDecision {
  toolCalls: { name: string; input: Record<string, unknown> }[];
  text: string;
  tokenUsage: number;
}

/**
 * The seam every LLM backend an agent can run on implements — mirrors {@link GitProvider}'s
 * role for git hosts (see server/src/services/GitProvider.ts): `EventEngine.decideAgentActions`
 * talks only to whatever `AgentRuntime` an `Agent.runtime` resolves to via
 * `AgentRuntimeRegistry`, never to a concrete SDK. Unlike git, this app does ship a default
 * implementation (`OllamaAgentRuntime`, talking to a local Ollama server) since agents already
 * need to actually work out of the box — chosen specifically so this app has zero required
 * dependency on any hosted model provider. A cloud backend (Anthropic, OpenAI, ...) is meant to
 * arrive later as a third-party `AgentRuntime` registered alongside this one, not something
 * this app bundles itself.
 */
export interface AgentRuntime {
  readonly id: string;

  /** One non-streaming decision turn: given a system prompt, the conversation so far, and a closed tool vocabulary, decide what (if anything) to do. */
  decide(opts: { model: string; system: string; userMessage: string; tools: AgentRuntimeTool[] }): Promise<AgentRuntimeDecision>;
}

/**
 * Looks up a registered `AgentRuntime` by id. Deliberately not built on a shared generic
 * registry base with `GitProviderRegistry` (services/GitProvider.ts) — see that file's
 * `GitProviderRegistry` doc comment for why: the two share nothing beyond a `Map` lookup,
 * which doesn't justify a common ancestor type.
 */
export class AgentRuntimeRegistry {
  private readonly runtimes = new Map<string, AgentRuntime>();

  register(runtime: AgentRuntime): void {
    this.runtimes.set(runtime.id, runtime);
  }

  resolve(id: string): AgentRuntime {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error(`No agent runtime registered for "${id}"`);
    return runtime;
  }

  list(): AgentRuntime[] {
    return [...this.runtimes.values()];
  }
}
