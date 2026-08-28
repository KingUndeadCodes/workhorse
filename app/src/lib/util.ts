import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import { PROJECT_COLORS, replaceMentions, STORY_POINT_VALUES } from '$domain';
import type { AgentRun, AgentRunStatus, AutomationAction, Comment, EventEnvelope, EventType, FieldDefinition, Label, Mentionable, StatsWindow, User, Workflow } from '$domain';

/** The resolved value of the `t`/`tn` i18n stores (see `lib/i18n/index.ts`) — plain functions,
 * not stores, since these are called from ordinary functions below rather than `.svelte`
 * markup. Callers pass `$t`/`$tn` from their own component. */
type Translate = (key: string, params?: Record<string, string | number>) => string;
type TranslatePlural = (key: string, count: number, params?: Record<string, string | number>) => string;

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

/**
 * Removes a comment and every reply beneath it (transitively) from a comment list — the local
 * mirror of the server's cascade delete (IssueRepository.deleteComment). Shared by the
 * locally-initiated delete path (stores/workspace.ts's removeComment) and the WebSocket-driven
 * one (ws.ts's comment.deleted handler) so the two can't silently diverge on what counts as
 * "beneath" a deleted comment.
 */
export function removeCommentSubtree(list: Comment[], commentId: string): Comment[] {
  const toRemove = new Set([commentId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of list) {
      if (c.parentCommentId && toRemove.has(c.parentCommentId) && !toRemove.has(c.id)) {
        toRemove.add(c.id);
        grew = true;
      }
    }
  }
  return list.filter((c) => !toRemove.has(c.id));
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

/** Renders a stored (lowercased) keybind — e.g. `'w'` or `'shift'` — the way a user typed it:
 * single letters uppercased, named keys capitalized, symbols like `[`/`?` left as-is. */
export function formatKeyLabel(key: string): string {
  if (key.length === 1) return /[a-z]/.test(key) ? key.toUpperCase() : key;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Splits a user list into humans first, agents last — the grouping every people-picker
 * (assignee list, etc.) uses so AI agents always sit in their own section at the bottom.
 */
export function splitHumansAndAgents<T extends { kind: string }>(users: T[]): { humans: T[]; agents: T[] } {
  return { humans: users.filter((u) => u.kind !== 'agent'), agents: users.filter((u) => u.kind === 'agent') };
}

/** All-time token usage across every run an agent has ever made — the same field `withinBudget`
 * sums for `maxSpendPerDay` (server/src/services/EventEngine.ts), just not scoped to today here. */
export function totalTokensForAgent(agentUserId: string, agentRuns: AgentRun[]): number {
  return agentRuns.filter((r) => r.agentUserId === agentUserId).reduce((sum, r) => sum + (r.tokenUsage ?? 0), 0);
}

/** Every run for one agent, newest first — from the already-loaded `agentRuns` store, no extra fetch. */
export function recentRunsForAgent(agentUserId: string, agentRuns: AgentRun[], limit = 5): AgentRun[] {
  return agentRuns
    .filter((r) => r.agentUserId === agentUserId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

export function agentRunStatusLabel(status: AgentRunStatus, t: Translate): string {
  return t(`agentsSettings.statusLabels.${status}`);
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

/** Formats an ISO timestamp as "today", "N days ago", or a locale date beyond a month.
 * `localeId` only affects that last, `toLocaleDateString` case — pass the active `Locale`. */
export function formatRelativeDate(iso: string, t: Translate, tn: TranslatePlural, localeId = 'en'): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const dayMs = 24 * 60 * 60 * 1000;
  const days = Math.round(diffMs / dayMs);
  if (days <= 0) return t('relativeDate.today');
  if (days < 30) return tn('relativeDate.daysAgo', days);
  return new Date(iso).toLocaleDateString(localeId);
}

/** Formats a duration in seconds as whole or one-decimal hours, e.g. "6h" or "2.5h". */
export function formatDuration(seconds: number): string {
  const hours = seconds / 3600;
  return `${hours % 1 === 0 ? hours : hours.toFixed(1)}h`;
}

/** Formats a fractional hour count via `Intl.NumberFormat` — just the numeral (e.g. "6.5"),
 * callers supply their own unit/suffix text. Pass the active `Locale` so grouping/decimal
 * separators match it (e.g. "6,5" in most European locales) rather than always reading English. */
export function formatHours(hours: number, localeId = 'en', maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(localeId, { maximumFractionDigits }).format(hours);
}

/** X-axis label for one time-spent bucket — hour-of-day for the 24h window (hourly buckets), short weekday/date for 1w/30d (daily buckets). */
export function formatBucketLabel(iso: string, window: StatsWindow, localeId = 'en'): string {
  const date = new Date(iso);
  if (window === '24h') return date.toLocaleTimeString(localeId, { hour: 'numeric' });
  if (window === '1w') return date.toLocaleDateString(localeId, { weekday: 'short' });
  return date.toLocaleDateString(localeId, { month: 'short', day: 'numeric' });
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
export function storyPointDueDateWarning(points: number, dueDate: string | undefined, t: Translate, tn: TranslatePlural, today: Date = new Date()): string | null {
  if (!dueDate) return null;
  const maxDays = STORY_POINT_MAX_DAYS[points as StoryPointValue];
  if (maxDays === undefined) return null;
  const dayMs = 24 * 60 * 60 * 1000;
  const daysUntilDue = (new Date(`${dueDate}T00:00:00`).getTime() - new Date(today.toDateString()).getTime()) / dayMs;
  if (daysUntilDue < 0) return t('storyPointWarning.pastDue', { points });
  if (daysUntilDue < maxDays) {
    const maxDuration = maxDays < 1 ? t('storyPointWarning.hoursDuration', { hours: maxDays * 24 }) : tn('storyPointWarning.daysDuration', maxDays);
    return t('storyPointWarning.tooSoon', { points, maxDuration, daysUntilDue: tn('storyPointWarning.daysDuration', Math.round(daysUntilDue)) });
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
export function describeEventType(type: EventType, t: Translate): string {
  switch (type) {
    case 'issue.created':
      return t('activity.eventType.issueCreated');
    case 'issue.statusChanged':
      return t('activity.eventType.issueStatusChanged');
    case 'issue.resolved':
      return t('activity.eventType.issueResolved');
    case 'issue.reopened':
      return t('activity.eventType.issueReopened');
    case 'issue.assigneesChanged':
      return t('activity.eventType.issueAssigneesChanged');
    case 'issue.agentAssigned':
      return t('activity.eventType.issueAgentAssigned');
    case 'issue.agentUnassigned':
      return t('activity.eventType.issueAgentUnassigned');
    case 'issue.priorityChanged':
      return t('activity.eventType.issuePriorityChanged');
    case 'issue.labelsChanged':
      return t('activity.eventType.issueLabelsChanged');
    case 'issue.dueDateChanged':
      return t('activity.eventType.issueDueDateChanged');
    case 'issue.sprintChanged':
      return t('activity.eventType.issueSprintChanged');
    case 'issue.updated':
      return t('activity.eventType.issueUpdated');
    case 'issue.linked':
      return t('activity.eventType.issueLinked');
    case 'issue.unlinked':
      return t('activity.eventType.issueUnlinked');
    case 'issue.deleted':
      return t('activity.eventType.issueDeleted');
    case 'issue.worklogAdded':
      return t('activity.eventType.issueWorklogAdded');
    case 'issue.attachmentAdded':
      return t('activity.eventType.issueAttachmentAdded');
    case 'issue.attachmentRemoved':
      return t('activity.eventType.issueAttachmentRemoved');
    case 'issue.branchCreated':
      return t('activity.eventType.issueBranchCreated');
    case 'issue.branchDeleted':
      return t('activity.eventType.issueBranchDeleted');
    case 'comment.created':
      return t('activity.eventType.commentCreated');
    case 'comment.edited':
      return t('activity.eventType.commentEdited');
    case 'comment.deleted':
      return t('activity.eventType.commentDeleted');
    case 'comment.mentioned':
      return t('activity.eventType.commentMentioned');
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
export function describeEvent(event: EventEnvelope, ctx: { workflow: Workflow | null; labels: Label[]; users: User[] }, t: Translate): string {
  const p = event.payload;
  const statusName = (id: string) => ctx.workflow?.statuses.find((s) => s.id === id)?.name ?? id;
  const labelName = (id: string) => ctx.labels.find((l) => l.id === id)?.name ?? id;
  const userName = (id: string) => ctx.users.find((u) => u.id === id)?.displayName ?? id;
  switch (p.type) {
    case 'issue.created':
      return t('activity.event.issueCreated');
    case 'issue.statusChanged':
      return t('activity.event.issueStatusChanged', { from: statusName(p.fromStatusId), to: statusName(p.toStatusId) });
    case 'issue.resolved':
      return t('activity.event.issueResolved', { status: statusName(p.statusId) });
    case 'issue.reopened':
      return t('activity.event.issueReopened', { status: statusName(p.statusId) });
    case 'issue.assigneesChanged':
      return p.toUserIds.length
        ? t('activity.event.assigneesChangedTo', { from: p.fromUserIds.map(userName).join(', ') || t('activity.event.noOne'), to: p.toUserIds.map(userName).join(', ') })
        : t('activity.event.assigneesUnassignedAll', { from: p.fromUserIds.map(userName).join(', ') || t('activity.event.noOne') });
    case 'issue.agentAssigned':
      return t('activity.event.issueAgentAssigned');
    case 'issue.agentUnassigned':
      return t('activity.event.issueAgentUnassigned');
    case 'issue.priorityChanged':
      return t('activity.event.issuePriorityChanged', { from: p.fromPriority, to: p.toPriority });
    case 'issue.labelsChanged':
      return t('activity.event.issueLabelsChanged', {
        from: p.fromLabelIds.map(labelName).join(', ') || t('activity.event.labelsNone'),
        to: p.toLabelIds.map(labelName).join(', ') || t('activity.event.labelsNone'),
      });
    case 'issue.dueDateChanged':
      return p.toDueDate ? t('activity.event.dueDateSet', { date: p.toDueDate }) : t('activity.event.dueDateCleared');
    case 'issue.sprintChanged':
      return p.toSprintId ? t('activity.event.sprintSet') : t('activity.event.sprintCleared');
    case 'issue.updated':
      return t('activity.event.issueUpdated', { fields: Object.keys(p.changes).join(', ') || t('activity.event.issueUpdatedFallback') });
    case 'issue.linked':
      return t('activity.event.issueLinked');
    case 'issue.unlinked':
      return t('activity.event.issueUnlinked');
    case 'issue.deleted':
      return t('activity.event.issueDeleted');
    case 'issue.worklogAdded':
      return t('activity.event.worklogAdded', { duration: formatDuration(p.timeSpentSeconds) });
    case 'issue.attachmentAdded':
      return t('activity.event.attachmentAdded', { fileName: p.fileName });
    case 'issue.attachmentRemoved':
      return t('activity.event.attachmentRemoved');
    case 'issue.branchCreated':
      return t('activity.event.branchCreated', { name: p.name });
    case 'issue.branchDeleted':
      return t('activity.event.branchDeleted');
    case 'comment.created':
      return p.parentCommentId ? t('activity.event.commentReplied') : t('activity.event.commentCreated');
    case 'comment.edited':
      return t('activity.event.commentEdited');
    case 'comment.deleted':
      return t('activity.event.commentDeleted');
    case 'comment.mentioned':
      return t('activity.event.commentMentioned');
    default:
      return p.type.replace(/[._]/g, ' ');
  }
}

/** One-line human-readable summary of an automation/agent action, e.g. "→ In Progress" or `comment "Thanks!"` — shared between the Automations rule list and Agents' proposed/past-run displays. */
export function describeAutomationAction(a: AutomationAction, ctx: { workflow: Workflow | null; users: User[]; fieldDefinitions: FieldDefinition[] }, t: Translate): string {
  switch (a.type) {
    case 'transitionStatus':
      return t('automation.action.transitionStatus', { status: ctx.workflow?.statuses.find((s) => s.id === a.toStatusId)?.name ?? a.toStatusId });
    case 'assignTo':
      return t('automation.action.assignTo', { name: ctx.users.find((u) => u.id === a.userId)?.displayName ?? a.userId });
    case 'addComment':
      return t('automation.action.addComment', { body: a.body.length > 30 ? `${a.body.slice(0, 30)}…` : a.body });
    case 'setField':
      return t('automation.action.setField', { field: ctx.fieldDefinitions.find((f) => f.id === a.fieldId)?.name ?? a.fieldId, value: JSON.stringify(a.value) });
    case 'readRepoFile':
      return t('automation.action.readRepoFile', { path: a.path });
    case 'writeRepoFile':
      return t('automation.action.writeRepoFile', { path: a.path, branch: a.branchName });
  }
}
