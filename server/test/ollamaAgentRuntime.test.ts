import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaAgentRuntime } from '../src/services/OllamaAgentRuntime';

describe('OllamaAgentRuntime.checkHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports ok when Ollama responds successfully', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('http://localhost:11434/api/tags');
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }),
    );

    const result = await new OllamaAgentRuntime().checkHealth();

    expect(result).toEqual({ ok: true });
  });

  it('reports not ok, with the status code, when Ollama responds with a failure status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));

    const result = await new OllamaAgentRuntime().checkHealth();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('500');
  });

  it('reports not ok, with the error message, when the request itself fails (e.g. connection refused)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed: ECONNREFUSED');
      }),
    );

    const result = await new OllamaAgentRuntime().checkHealth();

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/ECONNREFUSED/);
  });

  it('respects OLLAMA_HOST when set', async () => {
    const original = process.env.OLLAMA_HOST;
    process.env.OLLAMA_HOST = 'http://custom-ollama:9999';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe('http://custom-ollama:9999/api/tags');
        return new Response('{}', { status: 200 });
      }),
    );

    await new OllamaAgentRuntime().checkHealth();

    process.env.OLLAMA_HOST = original;
  });
});
