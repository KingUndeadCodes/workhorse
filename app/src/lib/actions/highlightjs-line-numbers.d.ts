// highlightjs-line-numbers.js ships no types (and no ESM export — it's a classic script that
// patches methods onto the global `hljs`, see lineNumbers.ts). Imported for its side effect
// only, so an empty module declaration is enough to satisfy TypeScript.
declare module 'highlightjs-line-numbers.js';
