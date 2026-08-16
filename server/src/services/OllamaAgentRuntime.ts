import type { AgentRuntime, AgentRuntimeDecision, AgentRuntimeTool } from './AgentRuntime';

/** Shape of Ollama's `/api/chat` response — only the fields this runtime reads. */
interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * The default (and today, only shipped) {@link AgentRuntime} — talks to a local Ollama server
 * over plain `fetch`, no SDK dependency, so this app has zero required ties to any hosted
 * model provider out of the box. A cloud backend (Anthropic, OpenAI, ...) is exactly the kind
 * of thing meant to arrive as a third-party `AgentRuntime` implementation registered
 * alongside this one — see AgentRuntime.ts's doc comment — not something this app bundles.
 *
 * Ollama's own tool-calling format is OpenAI-style (`{ type: 'function', function: {...} }`),
 * translated here from/to the provider-neutral {@link AgentRuntimeTool} shape so nothing above
 * this file needs to know that.
 */
export class OllamaAgentRuntime implements AgentRuntime {
  readonly id = 'ollama';

  private readonly host = process.env.OLLAMA_HOST?.trim() || 'http://localhost:11434';

  async decide(opts: { model: string; system: string; userMessage: string; tools: AgentRuntimeTool[] }): Promise<AgentRuntimeDecision> {
    const tools = opts.tools.map((t) => ({
      type: 'function' as const,
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    }));

    let response: OllamaChatResponse;
    try {
      const res = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.userMessage },
          ],
          tools,
          stream: false,
        }),
      });
      if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
      response = (await res.json()) as OllamaChatResponse;
    } catch (err) {
      throw new Error(`Agent model call failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    let toolCalls: AgentRuntimeDecision['toolCalls'] = (response.message.tool_calls ?? []).map((call) => ({
      name: call.function.name,
      input: call.function.arguments,
    }));
    let text = response.message.content ?? '';

    // Some models Ollama serves (observed with qwen2.5-coder) don't populate the structured
    // `tool_calls` field at all — they write the exact same `{"name": ..., "arguments": {...}}`
    // shape as plain text instead, sometimes wrapped in a ```json fence. Without this fallback
    // that reads as "no action proposed" even though the model clearly tried to call a tool.
    // Only trusted when it's the *entire* content (not a call embedded in a longer explanation)
    // and names a tool that was actually offered this turn — so a hallucinated call to a tool
    // this agent isn't even allowed to use (seen in testing) is correctly ignored, and prose
    // that merely mentions a tool's name can't be mistaken for calling it.
    const unfenced = text.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1');
    if (toolCalls.length === 0 && unfenced.startsWith('{')) {
      try {
        const parsed = JSON.parse(unfenced) as { name?: unknown; arguments?: unknown };
        if (typeof parsed.name === 'string' && opts.tools.some((t) => t.name === parsed.name) && typeof parsed.arguments === 'object' && parsed.arguments !== null) {
          toolCalls = [{ name: parsed.name, input: parsed.arguments as Record<string, unknown> }];
          text = '';
        }
      } catch {
        // Not JSON — genuinely free text, leave toolCalls empty.
      }
    }

    const tokenUsage = (response.prompt_eval_count ?? 0) + (response.eval_count ?? 0);
    return { toolCalls, text, tokenUsage };
  }
}
