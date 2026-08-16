import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import path from 'path'
import { readFileSync } from 'fs'

interface UiConfig {
  font: { family: string; googleFontsUrl: string };
}

/**
 * Substitutes `{{UI_FONT_FAMILY}}` / `{{UI_FONT_GOOGLE_URL}}` in index.html with the values
 * from ui.config.json — a plain committed config file rather than an env var, since the UI
 * font isn't secret/per-deployment, just something to switch and try out (see index.html's
 * comment for how it's consumed). Re-reads the file on every request in dev, so editing
 * ui.config.json and reloading the page is enough; no server restart needed.
 */
function uiConfigHtmlPlugin(): Plugin {
  return {
    name: 'ui-config-html',
    transformIndexHtml(html) {
      const config = JSON.parse(readFileSync(new URL('./ui.config.json', import.meta.url), 'utf-8')) as UiConfig;
      return html
        .replaceAll('{{UI_FONT_FAMILY}}', config.font.family)
        .replaceAll('{{UI_FONT_GOOGLE_URL}}', config.font.googleFontsUrl);
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), uiConfigHtmlPlugin()],
  resolve: {
    alias: {
      $domain: path.resolve(__dirname, '../domain'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
})
