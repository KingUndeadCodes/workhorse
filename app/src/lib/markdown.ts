import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import { replaceMentions } from '$domain';
import type { Mentionable } from '$domain';

/**
 * Markdown rendering for comments and descriptions. Lives apart from util.ts on purpose: these libraries are
 * large, util.ts is imported by the signed-out landing page, and only the issue drawer and comment threads ever
 * render markdown — so they should travel with the signed-in app, not with every first visit. Don't re-export
 * this from util.ts.
 */

marked.setOptions({ breaks: true, gfm: true });
// Syntax-highlights fenced code blocks (```js, ```python, ...) via highlight.js, tagging each
// token with an .hljs-* class. No hardcoded theme here — the colors for those classes live in
// CommentThread.svelte/IssueDrawer.svelte's :global(.hljs-*) rules, built from the same
// --accent/--success/--text-3/etc. tokens as everything else, so highlighted code follows the
// light/dark toggle and color scheme for free instead of needing its own light/dark stylesheet.
marked.use(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }),
);


/**
 * Wraps every "@Full Name" occurrence that matches a real workspace user in a `<span>`, so
 * `renderMarkdown` can turn it into a styled mention pill. The match itself — what counts as a
 * mention at all — is `domain/mentions.ts`'s `replaceMentions`, shared with the server's
 * `comment.mentioned` event detection so the two can't drift into recognizing different things
 * as mentions; this function only supplies the HTML the match gets turned into.
 */
function highlightMentions(text: string, users: Mentionable[]): string {
  return replaceMentions(text, users, (name, user) => {
    const cls = user.kind === 'agent' ? 'mention mention-agent' : 'mention';
    return `<span class="${cls}">@${name}</span>`;
  });
}

/**
 * Renders user-authored markdown (comments, descriptions) to sanitized HTML for `{@html}`.
 * Sanitizing is not optional: markdown allows raw inline HTML, and comment bodies are other
 * users' input — skipping this would be a stored-XSS hole the moment a second person joins.
 * `mentionUsers`, if given, turns any "@Full Name" match into a styled mention span.
 */
export function renderMarkdown(text: string, mentionUsers: Mentionable[] = []): string {
  if (!text.trim()) return '';
  const withMentions = highlightMentions(text, mentionUsers);
  const html = marked.parse(withMentions, { async: false }) as string;
  return DOMPurify.sanitize(html);
}
