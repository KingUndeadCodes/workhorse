import type { EntityRef, EventEnvelope, EventPayload } from './domain';
import { all, eventsDb, get, persistEvents, run } from './db/core';

interface EventRow {
  id: string;
  workspace_id: string;
  sequence: number;
  occurred_at: string;
  actor: string;
  subject_type: string;
  subject_id: string;
  payload: string;
}

function rowToEvent(row: EventRow): EventEnvelope {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sequence: row.sequence,
    occurredAt: row.occurred_at,
    actor: JSON.parse(row.actor),
    subject: { type: row.subject_type, id: row.subject_id } as EntityRef,
    payload: JSON.parse(row.payload) as EventPayload,
  };
}

/** The next sequence number for a workspace — `MAX(sequence) + 1`, computed from the log itself rather than a counter kept elsewhere. */
function nextSequence(workspaceId: string): number {
  const row = get<{ maxSeq: number | null }>(eventsDb, `SELECT MAX(sequence) as maxSeq FROM events WHERE workspace_id = ?`, [workspaceId]);
  return (row?.maxSeq ?? 0) + 1;
}

/**
 * Appends one entry to the durable, append-only event log and persists it to `events.db`
 * immediately — this is the only function in the server that writes to that file.
 */
export function appendEvent(entry: { actor: EventEnvelope['actor']; subject: EntityRef; payload: EventPayload }, id: string, workspaceId: string): EventEnvelope {
  const event: EventEnvelope = {
    id,
    workspaceId,
    sequence: nextSequence(workspaceId),
    occurredAt: new Date().toISOString(),
    ...entry,
  };
  run(eventsDb, `INSERT INTO events (id, workspace_id, sequence, occurred_at, actor, subject_type, subject_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [
    event.id,
    event.workspaceId,
    event.sequence,
    event.occurredAt,
    JSON.stringify(event.actor),
    event.subject.type,
    event.subject.id,
    JSON.stringify(event.payload),
  ]);
  persistEvents();
  return event;
}

export function getAllEvents(workspaceId: string): EventEnvelope[] {
  return all<EventRow>(eventsDb, `SELECT * FROM events WHERE workspace_id = ? ORDER BY sequence ASC`, [workspaceId]).map(rowToEvent);
}

export function getEventsSince(workspaceId: string, sequence: number): EventEnvelope[] {
  return all<EventRow>(eventsDb, `SELECT * FROM events WHERE workspace_id = ? AND sequence > ? ORDER BY sequence ASC`, [workspaceId, sequence]).map(rowToEvent);
}

/**
 * Every event whose payload carries this `issueId` — the issue's own lifecycle (status,
 * assignees, links, worklogs, branches, ...) plus every comment event on it, since comments
 * carry their parent issue's id too. This is a full table scan of the log filtered in JS
 * rather than a SQL `WHERE`, same tradeoff `AuditService` already makes with `getAllEvents`:
 * `payload` is opaque JSON to SQLite, so there's no column to index on without denormalizing
 * `issueId` onto the row, which nothing else here needs. Fine at this app's scale.
 */
export function getEventsForIssue(workspaceId: string, issueId: string): EventEnvelope[] {
  return getAllEvents(workspaceId).filter((e) => 'issueId' in e.payload && e.payload.issueId === issueId);
}

export function getEventById(id: string): EventEnvelope | undefined {
  const row = get<EventRow>(eventsDb, `SELECT * FROM events WHERE id = ?`, [id]);
  return row ? rowToEvent(row) : undefined;
}
