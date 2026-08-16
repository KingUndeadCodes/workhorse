import { existsSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PluginContext, WorkhorsePlugin } from './PluginContext';

/**
 * Scans `pluginsDir` (top-level entries only — a plugin is one file, not a nested project) for
 * `.ts`/`.js` modules, dynamically imports each, and calls its default-exported
 * `WorkhorsePlugin.register(ctx)`. This is the actual "install an extension without touching
 * core" mechanism `container.ts`'s `GitProvider`/`AgentRuntime` doc comments point to — a
 * deployment adds git-host or LLM-backend support by dropping a file here, not by editing this
 * repo. Missing directory is not an error (a fresh checkout has none); one plugin failing to
 * load or register is logged and skipped, not fatal to boot — a broken third-party file
 * shouldn't take the whole server down.
 */
export async function loadPlugins(pluginsDir: string, ctx: PluginContext): Promise<void> {
  if (!existsSync(pluginsDir)) return;

  const files = readdirSync(pluginsDir, { withFileTypes: true })
    .filter((e) => e.isFile() && ['.ts', '.js'].includes(extname(e.name)))
    .map((e) => e.name)
    .sort();

  for (const file of files) {
    const fullPath = join(pluginsDir, file);
    try {
      const mod: { default?: WorkhorsePlugin } = await import(pathToFileURL(fullPath).href);
      const plugin = mod.default;
      if (!plugin || typeof plugin.register !== 'function') {
        console.error(`Plugin "${file}" has no default-exported WorkhorsePlugin ({ id, register }) — skipped.`);
        continue;
      }
      await plugin.register(ctx);
      console.log(`Loaded plugin "${plugin.id}" from plugins/${file}`);
    } catch (err) {
      console.error(`Failed to load plugin "${file}":`, err instanceof Error ? err.message : err);
    }
  }
}
