import { get } from 'svelte/store';
import type { EventEnvelope, FieldValue } from '$domain';
import { authToken } from './stores/auth';
import { attachments, comments, currentProjectId, initWorkspace, issueLinks, issuesStore, sprints, worklogs } from './stores/workspace';

/**
 * Live updates over one WebSocket per tab: every event the server appends (see
 * server/src/ws.ts) arrives here and is applied directly to the same Svelte stores
 * `initWorkspace` populated on load — no polling, no manual reload to see what a teammate, an
 * automation, or an agent just did.
 *
 * Coverage is deliberately partial: the frequent, high-value mutations (issues, comments,
 * board/sprint membership) are patched in place; anything rarer or whose payload doesn't carry
 * enough to patch correctly (agent run bookkeeping, automation execution, git branch/file
 * events) falls back to a full `initWorkspace()` refetch — slower, but never wrong. Promote a
 * case out of the fallback only once it's actually worth the patching code.
 */

let socket: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectWebSocket(): void {
  const token = get(authToken);
  if (!token) return;
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`);

  socket.addEventListener('open', () => {
    // A nonzero reconnectAttempt means this `open` follows a real drop, not the initial
    // connect — whatever happened while disconnected was never received, so catch up with a
    // full refetch rather than silently resuming with stale state. Same fallback this file
    // already uses per-event for rare/complex payloads, just triggered by the reconnect itself.
    if (reconnectAttempt > 0) initWorkspace();
    reconnectAttempt = 0;
  });
  socket.addEventListener('message', (e) => {
    try {
      applyRemoteEvent(JSON.parse(e.data as string) as EventEnvelope);
    } catch (err) {
      console.error('Failed to apply live update:', err);
    }
  });
  socket.addEventListener('close', scheduleReconnect);
  socket.addEventListener('error', () => socket?.close());
}

export function disconnectWebSocket(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  socket?.close();
  socket = null;
}

/** Capped exponential backoff (1s, 2s, 4s, ... up to 30s) — a dropped wifi connection shouldn't hammer the server with reconnect attempts once it's back. */
function scheduleReconnect(): void {
  if (!get(authToken)) return; // logged out — don't reconnect until logged back in
  const delay = Math.min(30_000, 1000 * 2 ** reconnectAttempt);
  reconnectAttempt++;
  reconnectTimer = setTimeout(connectWebSocket, delay);
}

function isCurrentProject(projectId: string | undefined): boolean {
  return projectId === undefined || projectId === get(currentProjectId);
}

function applyRemoteEvent(event: EventEnvelope): void {
  const { payload } = event;
  switch (payload.type) {
    case 'issue.created':
      if (payload.issue.projectId !== get(currentProjectId)) return;
      issuesStore.update((list) => (list.some((i) => i.id === payload.issueId) ? list : [...list, payload.issue]));
      return;
    case 'issue.statusChanged':
      issuesStore.update((list) => list.map((i) => (i.id === payload.issueId ? { ...i, statusId: payload.toStatusId } : i)));
      return;
    case 'issue.assigneesChanged':
      issuesStore.update((list) => list.map((i) => (i.id === payload.issueId ? { ...i, assigneeIds: payload.toUserIds } : i)));
      return;
    case 'issue.sprintChanged':
      issuesStore.update((list) => list.map((i) => (i.id === payload.issueId ? { ...i, sprintId: payload.toSprintId } : i)));
      return;
    case 'issue.priorityChanged':
      issuesStore.update((list) => list.map((i) => (i.id === payload.issueId ? { ...i, priority: payload.toPriority } : i)));
      return;
    case 'issue.labelsChanged':
      issuesStore.update((list) => list.map((i) => (i.id === payload.issueId ? { ...i, labelIds: payload.toLabelIds } : i)));
      return;
    case 'issue.dueDateChanged':
      issuesStore.update((list) => list.map((i) => (i.id === payload.issueId ? { ...i, dueDate: payload.toDueDate } : i)));
      return;
    case 'issue.updated':
      issuesStore.update((list) => list.map((i) => (i.id === payload.issueId ? { ...i, ...payload.changes } : i)));
      return;
    case 'issue.fieldChanged':
      issuesStore.update((list) =>
        list.map((i) => {
          if (i.id !== payload.issueId) return i;
          const fieldValues = i.fieldValues.filter((f) => f.fieldId !== payload.fieldId);
          fieldValues.push({ fieldId: payload.fieldId, value: payload.toValue as FieldValue['value'] });
          return { ...i, fieldValues };
        }),
      );
      return;
    case 'issue.deleted':
      issuesStore.update((list) => list.filter((i) => i.id !== payload.issueId));
      return;
    case 'comment.created':
      comments.update((list) =>
        list.some((c) => c.id === payload.commentId)
          ? list
          : [
              ...list,
              {
                id: payload.commentId,
                issueId: payload.issueId,
                authorId: payload.authorId,
                body: { format: 'richtext-v1', content: null, plainText: payload.body },
                parentCommentId: payload.parentCommentId,
                createdAt: event.occurredAt,
              },
            ],
      );
      return;
    case 'comment.edited':
      comments.update((list) =>
        list.map((c) => (c.id === payload.commentId ? { ...c, body: { ...c.body, plainText: payload.body }, editedAt: event.occurredAt } : c)),
      );
      return;
    case 'comment.deleted': {
      // Mirrors the server's cascade (IssueRepository.deleteComment) locally — see removeComment in stores/workspace.ts, same logic.
      comments.update((list) => {
        const toRemove = new Set([payload.commentId]);
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
      });
      return;
    }
    case 'issue.worklogAdded':
      worklogs.update((list) =>
        list.some((w) => w.id === payload.worklogId)
          ? list
          : [...list, { id: payload.worklogId, issueId: payload.issueId, authorId: payload.authorId, timeSpentSeconds: payload.timeSpentSeconds, note: payload.note, startedAt: event.occurredAt }],
      );
      return;
    case 'issue.attachmentAdded':
      attachments.update((list) =>
        list.some((a) => a.id === payload.attachmentId)
          ? list
          : [
              ...list,
              {
                id: payload.attachmentId, issueId: payload.issueId, uploadedBy: payload.uploadedBy,
                fileName: payload.fileName, url: payload.url, mimeType: payload.mimeType, sizeBytes: payload.sizeBytes, createdAt: event.occurredAt,
              },
            ],
      );
      return;
    case 'issue.linked':
      issueLinks.update((list) =>
        list.some((l) => l.id === payload.linkId)
          ? list
          : [...list, { id: payload.linkId, type: payload.linkType, sourceIssueId: payload.issueId, targetIssueId: payload.linkedIssueId, createdAt: event.occurredAt, createdBy: event.actor.kind === 'user' ? event.actor.userId : 'system' }],
      );
      return;
    case 'issue.unlinked':
      issueLinks.update((list) => list.filter((l) => l.id !== payload.linkId));
      return;
    case 'sprint.started':
      sprints.update((list) => list.map((s) => (s.id === payload.sprintId ? { ...s, state: 'active' as const } : s)));
      return;
    case 'sprint.completed':
      sprints.update((list) => list.map((s) => (s.id === payload.sprintId ? { ...s, state: 'closed' as const, completedAt: event.occurredAt } : s)));
      return;
    // Notification-only — the sibling event that always accompanies each of these
    // (comment.created, issue.statusChanged) already carried the actual state change. Explicit
    // no-ops rather than falling through to the refetch default, since comment.mentioned in
    // particular can fire multiple times per comment — a full refetch per mention would be the
    // single most wasteful thing this file could do.
    case 'comment.mentioned':
    case 'issue.resolved':
    case 'issue.reopened':
      return;
    case 'project.created':
      initWorkspace();
      return;
    default:
      // Everything else (agent run bookkeeping, automation execution, git branch/file events,
      // board/project-shape changes) — refetch rather than risk a half-correct patch. These are
      // all comparatively rare, so the extra round trip isn't the cost issue.created is.
      if (isCurrentProject('projectId' in payload && typeof payload.projectId === 'string' ? payload.projectId : undefined)) {
        initWorkspace();
      }
      return;
  }
}
