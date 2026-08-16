/** A user (or agent) mentionable via "@Full Name" in a comment or description. `kind` is optional since server-side mention *detection* (parseMentionedUserIds) doesn't need it — only the client's highlighter, which styles agent mentions differently, does. */
export interface Mentionable {
  id: string;
  displayName: string;
  kind?: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Splits on fenced/inline code spans so a mention inside `code` is never matched. */
function splitOutsideCode(text: string): { text: string; isCode: boolean }[] {
  const parts: { text: string; isCode: boolean }[] = [];
  const re = /(```[\s\S]*?```|`[^`]*`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), isCode: false });
    parts.push({ text: m[0], isCode: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), isCode: false });
  return parts;
}

/**
 * The one place "what counts as a mention" is decided — every "@Full Name" match outside code
 * spans, longest name first so multi-word names win over a shorter name that's a prefix of
 * them. Both `parseMentionedUserIds` below (server-side event emission) and the frontend's
 * markdown renderer (app/src/lib/util.ts's `renderMarkdown`) call this directly rather than
 * each deriving their own copy of the regex — previously they didn't, which meant "what the UI
 * highlights as a mention" and "what actually fires `comment.mentioned`" were two independently
 * -maintained patterns that happened to agree, not one pattern both used.
 *
 * `replace(name, user)` is called for each match and its return value substituted in place —
 * detection just collects the matched user (ignoring the replacement text), highlighting turns
 * it into a styled span. Matched against display names, not stored ids — same tradeoff
 * `slugifyBranchName` documents in integrations.ts: simple, but a later rename won't
 * retroactively relabel old mentions.
 */
export function replaceMentions(text: string, users: Mentionable[], replace: (name: string, user: Mentionable) => string): string {
  if (users.length === 0) return text;
  const sorted = [...users].sort((a, b) => b.displayName.length - a.displayName.length);
  const pattern = sorted.map((u) => escapeRegExp(u.displayName)).join('|');
  const byName = new Map(sorted.map((u) => [u.displayName, u]));
  const re = new RegExp(`@(${pattern})\\b`, 'g');

  return splitOutsideCode(text)
    .map(({ text: segment, isCode }) => {
      if (isCode) return segment;
      return segment.replace(re, (match, name: string) => {
        const user = byName.get(name);
        return user ? replace(name, user) : match;
      });
    })
    .join('');
}

/** Every user/agent whose "@Full Name" appears in `text` — see {@link replaceMentions}. Used by routes/issues.ts to decide which `comment.mentioned` events to emit. */
export function parseMentionedUserIds(text: string, users: Mentionable[]): string[] {
  const found = new Set<string>();
  replaceMentions(text, users, (name, user) => {
    found.add(user.id);
    return `@${name}`;
  });
  return [...found];
}
