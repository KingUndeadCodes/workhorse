import { defineConfig } from 'vitest/config';
import path from 'path';

// Standalone (not merged with vite.config.ts) on purpose: that file's plugins rewrite index.html and
// scan locales at build time, neither of which tests need. jsdom supplies localStorage/window for the
// stores, and DOMPurify for renderMarkdown.
export default defineConfig({
  resolve: { alias: { $domain: path.resolve(__dirname, '../domain') } },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
