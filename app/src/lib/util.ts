import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import { PROJECT_COLORS, replaceMentions, STORY_POINT_VALUES } from '$domain';
import type { AutomationAction, EventEnvelope, EventType, FieldDefinition, Label, Mentionable, User, Workflow } from '$domain';

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

export type { Mentionable };

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

/** Up to two uppercase initials from a display name, e.g. "Jordan Cole" -> "JC". */
export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Cheap, deterministic string hash (djb2) — not cryptographic, just needs to spread ids evenly across {@link PROJECT_COLORS}. */
function hashString(s: string): number {
  let hash = 5381;
  for (let i = 0; i < s.length; i++) hash = (hash * 33) ^ s.charCodeAt(i);
  return hash >>> 0;
}

/**
 * A user's avatar color, deterministic from their id — same on-brand palette
 * {@link PROJECT_COLORS} uses (one curated non-purple/non-black set instead of a second one
 * just for avatars), picked by hashing the id instead of a fixed per-user lookup table. A
 * fixed table only ever covered the ~7 seed users and silently gave everyone else the exact
 * same fallback gray; hashing spreads every user (seed or real) across the whole palette, and
 * stays stable for a given id since the hash is pure.
 */
export function avatarColor(userId: string): string {
  return PROJECT_COLORS[hashString(userId) % PROJECT_COLORS.length];
}

/** A user's plain display name — callers that render this as visible text should pair it with
 * an <Icon name="robot"> when `user.kind === 'agent'` (see CommentThread/IssueDrawer/etc.)
 * rather than baking a text marker in here; this stays plain since it also feeds non-visual
 * uses like an <Avatar>'s title attribute, where an icon can't go. */
export function displayName(user: { kind?: string; displayName: string }): string {
  return user.displayName;
}

/**
 * Splits a user list into humans first, agents last — the grouping every people-picker
 * (assignee list, etc.) uses so AI agents always sit in their own section at the bottom.
 */
export function splitHumansAndAgents<T extends { kind: string }>(users: T[]): { humans: T[]; agents: T[] } {
  return { humans: users.filter((u) => u.kind !== 'agent'), agents: users.filter((u) => u.kind === 'agent') };
}

/** Maps an {@link IssuePriority} to the icon name that represents it (see public/icons.svg). */
export function priorityIcon(priority: string): string {
  switch (priority) {
    case 'highest':
      return 'chevup2';
    case 'high':
      return 'chevup';
    case 'low':
      return 'chevdown';
    case 'lowest':
      return 'chevdown';
    default:
      return 'minus';
  }
}

/** Maps an issue type's display name to the icon name that represents it. */
export function typeIcon(typeName: string): string {
  if (typeName === 'Bug') return 'bug';
  if (typeName === 'Task') return 'task';
  return 'story';
}

/** Formats an ISO timestamp as "today", "N days ago", or a locale date beyond a month. */
export function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round(diffMs / dayMs);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

/** Formats a duration in seconds as whole or one-decimal hours, e.g. "6h" or "2.5h". */
export function formatDuration(seconds: number): string {
  const hours = seconds / 3600;
  return `${hours % 1 === 0 ? hours : hours.toFixed(1)}h`;
}

export type StoryPointValue = (typeof STORY_POINT_VALUES)[number];

/** Background/text colors per story point value, matching the standard estimation cheat-sheet gradient (light → red as size grows). */
const STORY_POINT_COLORS: Record<StoryPointValue, { bg: string; text: string }> = {
  1: { bg: '#F5F1FC', text: '#4A4458' },
  2: { bg: '#E4E4E8', text: '#3A3A42' },
  3: { bg: '#D3D3D8', text: '#2E2E33' },
  5: { bg: '#F0A94E', text: '#3A2400' },
  8: { bg: '#EF8B62', text: '#3A1400' },
  13: { bg: '#E85D5D', text: '#FFFFFF' },
};

export function storyPointColor(points: number): { bg: string; text: string } {
  return STORY_POINT_COLORS[points as StoryPointValue] ?? { bg: 'var(--surface-2)', text: 'var(--text-2)' };
}

/** Rough upper bound, in calendar days, on how long a ticket of this size should realistically take — the same "work effort" bands the cheat sheet uses. */
const STORY_POINT_MAX_DAYS: Record<StoryPointValue, number> = {
  1: 0.25,
  2: 0.5,
  3: 2,
  5: 4,
  8: 7,
  13: 14,
};

/**
 * Non-blocking sanity check: does the due date leave enough runway for this many story
 * points? Returns a warning string if the due date is sooner than the size's typical
 * effort would need, else `null`. Purely advisory — never used to block saving.
 */
export function storyPointDueDateWarning(points: number, dueDate: string | undefined, today: Date = new Date()): string | null {
  if (!dueDate) return null;
  const maxDays = STORY_POINT_MAX_DAYS[points as StoryPointValue];
  if (maxDays === undefined) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const daysUntilDue = (new Date(`${dueDate}T00:00:00`).getTime() - new Date(today.toDateString()).getTime()) / dayMs;
  if (daysUntilDue < 0) return `This due date has already passed, but the issue is still estimated at ${points} points.`;
  if (daysUntilDue < maxDays) {
    return `${points} points typically takes up to ${maxDays < 1 ? `${maxDays * 24}h` : `${maxDays} day${maxDays === 1 ? '' : 's'}`}, but the due date is only ${Math.round(daysUntilDue)} day${Math.round(daysUntilDue) === 1 ? '' : 's'} away.`;
  }
  return null;
}

/**
 * Generic one-line label for an Activity row's collapsed state — derived from the event's
 * `type` alone, since the row list ({@link ActivityEventSummary} in api.ts) is deliberately
 * sent without the full payload. Vaguer than {@link describeEvent} on purpose ("changed the
 * status" rather than "changed status to In Progress") — the specifics only get fetched, and
 * only get rendered, once a row is actually expanded.
 */
export function describeEventType(type: EventType): string {
  switch (type) {
    case 'issue.created':
      return 'created this issue';
    case 'issue.statusChanged':
      return 'changed the status';
    case 'issue.resolved':
      return 'resolved this issue';
    case 'issue.reopened':
      return 'reopened this issue';
    case 'issue.assigneesChanged':
      return 'changed assignees';
    case 'issue.agentAssigned':
      return 'attached an AI agent';
    case 'issue.agentUnassigned':
      return 'removed an AI agent';
    case 'issue.priorityChanged':
      return 'changed priority';
    case 'issue.labelsChanged':
      return 'changed labels';
    case 'issue.dueDateChanged':
      return 'changed the due date';
    case 'issue.sprintChanged':
      return 'changed the sprint';
    case 'issue.updated':
      return 'updated this issue';
    case 'issue.linked':
      return 'linked another issue';
    case 'issue.unlinked':
      return 'removed a linked issue';
    case 'issue.deleted':
      return 'deleted this issue';
    case 'issue.worklogAdded':
      return 'logged work';
    case 'issue.attachmentAdded':
      return 'added an attachment';
    case 'issue.branchCreated':
      return 'created a branch';
    case 'issue.branchDeleted':
      return 'deleted the branch';
    case 'comment.created':
      return 'added a comment';
    case 'comment.edited':
      return 'edited a comment';
    case 'comment.deleted':
      return 'deleted a comment';
    case 'comment.mentioned':
      return 'mentioned someone in a comment';
    default:
      return type.replace(/[._]/g, ' ');
  }
}

/**
 * One-line human-readable summary of a logged event's full detail, e.g. "changed status to
 * In Progress" or "added a comment". Needs the complete {@link EventEnvelope} (fetched only
 * once a row is expanded, see {@link describeEventType} for the collapsed-row equivalent) —
 * `who` said it is rendered separately by the caller (the actor is already resolved to a
 * display string there); this only covers the "what". Falls back to a de-camel-cased version
 * of the event's own type string for the long tail of event kinds that don't need a bespoke
 * phrasing (repo file reads/writes, agent run lifecycle, project/sprint events reaching this
 * issue indirectly, etc).
 */
export function describeEvent(event: EventEnvelope, ctx: { workflow: Workflow | null; labels: Label[]; users: User[] }): string {
  const p = event.payload;
  const statusName = (id: string) => ctx.workflow?.statuses.find((s) => s.id === id)?.name ?? id;
  const labelName = (id: string) => ctx.labels.find((l) => l.id === id)?.name ?? id;
  const userName = (id: string) => ctx.users.find((u) => u.id === id)?.displayName ?? id;
  switch (p.type) {
    case 'issue.created':
      return 'created this issue';
    case 'issue.statusChanged':
      return `changed status from ${statusName(p.fromStatusId)} to ${statusName(p.toStatusId)}`;
    case 'issue.resolved':
      return `resolved this issue (${statusName(p.statusId)})`;
    case 'issue.reopened':
      return `reopened this issue (${statusName(p.statusId)})`;
    case 'issue.assigneesChanged':
      return p.toUserIds.length
        ? `changed assignees from ${p.fromUserIds.map(userName).join(', ') || 'no one'} to ${p.toUserIds.map(userName).join(', ')}`
        : `unassigned everyone (was ${p.fromUserIds.map(userName).join(', ') || 'no one'})`;
    case 'issue.agentAssigned':
      return 'attached an AI agent';
    case 'issue.agentUnassigned':
      return 'removed an AI agent';
    case 'issue.priorityChanged':
      return `changed priority from ${p.fromPriority} to ${p.toPriority}`;
    case 'issue.labelsChanged':
      return `changed labels from ${p.fromLabelIds.map(labelName).join(', ') || 'none'} to ${p.toLabelIds.map(labelName).join(', ') || 'none'}`;
    case 'issue.dueDateChanged':
      return p.toDueDate ? `set the due date to ${p.toDueDate}` : 'cleared the due date';
    case 'issue.sprintChanged':
      return p.toSprintId ? 'moved this issue to a sprint' : 'moved this issue out of its sprint';
    case 'issue.updated':
      return `updated ${Object.keys(p.changes).join(', ') || 'this issue'}`;
    case 'issue.linked':
      return 'linked another issue';
    case 'issue.unlinked':
      return 'removed a linked issue';
    case 'issue.deleted':
      return 'deleted this issue';
    case 'issue.worklogAdded':
      return `logged ${formatDuration(p.timeSpentSeconds)} of work`;
    case 'issue.attachmentAdded':
      return `attached ${p.fileName}`;
    case 'issue.branchCreated':
      return `created branch ${p.name}`;
    case 'issue.branchDeleted':
      return 'deleted the branch';
    case 'comment.created':
      return p.parentCommentId ? 'replied to a comment' : 'added a comment';
    case 'comment.edited':
      return 'edited a comment';
    case 'comment.deleted':
      return 'deleted a comment';
    case 'comment.mentioned':
      return 'mentioned someone in a comment';
    default:
      return p.type.replace(/[._]/g, ' ');
  }
}

/** One-line human-readable summary of an automation/agent action, e.g. "→ In Progress" or `comment "Thanks!"` — shared between the Automations rule list and Agents' proposed/past-run displays. */
export function describeAutomationAction(a: AutomationAction, ctx: { workflow: Workflow | null; users: User[]; fieldDefinitions: FieldDefinition[] }): string {
  switch (a.type) {
    case 'transitionStatus':
      return `→ ${ctx.workflow?.statuses.find((s) => s.id === a.toStatusId)?.name ?? a.toStatusId}`;
    case 'assignTo':
      return `assign ${ctx.users.find((u) => u.id === a.userId)?.displayName ?? a.userId}`;
    case 'addComment':
      return `comment "${a.body.length > 30 ? `${a.body.slice(0, 30)}…` : a.body}"`;
    case 'setField':
      return `set ${ctx.fieldDefinitions.find((f) => f.id === a.fieldId)?.name ?? a.fieldId} = ${JSON.stringify(a.value)}`;
    case 'readRepoFile':
      return `read ${a.path}`;
    case 'writeRepoFile':
      return `write ${a.path} → branch "${a.branchName}"`;
  }
}
