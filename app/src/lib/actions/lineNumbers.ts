import { tick } from 'svelte';
import hljs from 'highlight.js';

type HljsWithLineNumbers = typeof hljs & { lineNumbersBlockSync: (element: HTMLElement) => void };

// highlightjs-line-numbers.js is a classic script, not an ES module — it patches methods onto
// whatever `hljs` it finds on `window` at load time. Static `import` declarations are always
// hoisted above other top-level code (even code written between two imports), so assigning
// `window.hljs` and then statically importing the plugin doesn't reliably run in that order —
// a dynamic `import()` is the only way to guarantee the assignment happens first. Same `hljs`
// instance util.ts's renderMarkdown already highlights code with.
let pluginLoaded: Promise<void> | undefined;
function ensurePluginLoaded(): Promise<void> {
  if (!pluginLoaded) {
    (window as unknown as { hljs: typeof hljs }).hljs = hljs;
    pluginLoaded = import('highlightjs-line-numbers.js').then(() => undefined);
  }
  return pluginLoaded;
}

/**
 * Svelte action: adds a line-number gutter to every highlight.js code block inside `node`,
 * turning each `<code class="hljs">` into a `<table class="hljs-ln">` (see
 * CommentThread.svelte / IssueDrawer.svelte for the `.hljs-ln-*` styling, built from the same
 * theme tokens as the syntax colors). Pass the same HTML string driving the sibling `{@html}`
 * block as this action's parameter — `{@html}` doesn't re-fire actions on its own, so `update`
 * needs a value that actually changes (a new comment, an edit, streamed agent output) to know
 * when to re-scan. `tick()` waits for that `{@html}` update to actually land in the DOM first.
 *
 * Idempotent per DOM node via a data attribute: running the plugin twice on an
 * already-transformed block would re-parse its own `<table>` output as source code and corrupt
 * it, but every real content change replaces the block with a fresh, unmarked one anyway.
 */
export function lineNumbers(node: HTMLElement, _html: string) {
  function run() {
    ensurePluginLoaded().then(() => {
      node.querySelectorAll<HTMLElement>('pre code.hljs').forEach((block) => {
        if (block.dataset.hljsLn) return;
        block.dataset.hljsLn = 'true';
        (hljs as HljsWithLineNumbers).lineNumbersBlockSync(block);
      });
    });
  }
  tick().then(run);
  return {
    update() {
      tick().then(run);
    },
  };
}
