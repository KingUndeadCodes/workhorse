import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

/**
 * Renders user-authored markdown (comments, descriptions) to sanitized HTML for `{@html}`.
 * Sanitizing is not optional: markdown allows raw inline HTML, and comment bodies are other
 * users' input — skipping this would be a stored-XSS hole the moment a second person joins.
 */
export function renderMarkdown(text: string): string {
  if (!text.trim()) return '';
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

/** Fixed per-user avatar colors, keyed by the seed data's user ids. */
const AVATAR_COLORS: Record<string, string> = {
  u_leon: '#946B3A',
  u_jordan: '#3B7DC4',
  u_mina: '#B9791A',
  u_riya: '#6E5DC6',
  u_sam: '#2E9E58',
  u_dana: '#8A8FA3',
  u_triage_bot: '#3E6FB0',
};

/** Up to two uppercase initials from a display name, e.g. "Jordan Cole" -> "JC". */
export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Looks up a user's avatar color, falling back to a neutral gray for unknown ids. */
export function avatarColor(userId: string): string {
  return AVATAR_COLORS[userId] ?? '#8A8FA3';
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
