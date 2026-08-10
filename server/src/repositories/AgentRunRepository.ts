import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToAgentRun } from '../db/mappers';
import type { AgentRun } from '../domain';

export class AgentRunRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async list(): Promise<AgentRun[]> {
    return (await this.db.selectFrom('agent_runs').selectAll().orderBy('started_at', 'asc').execute()).map(rowToAgentRun);
  }

  async get(id: string): Promise<AgentRun | undefined> {
    const row = await this.db.selectFrom('agent_runs').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? rowToAgentRun(row) : undefined;
  }

  /** Insert-or-update, keyed by run id — the same run row is written multiple times across its lifecycle. */
  async upsert(run: AgentRun): Promise<void> {
    const values = {
      id: run.id,
      agent_user_id: run.agentUserId,
      triggering_event_id: run.triggeringEventId,
      status: run.status,
      proposed_actions: JSON.stringify(run.proposedActions),
      applied_action_indexes: JSON.stringify(run.appliedActionIndexes ?? null),
      rationale: run.rationale ?? null,
      reviewed_by: run.reviewedBy ?? null,
      reviewed_at: run.reviewedAt ?? null,
      started_at: run.startedAt,
      completed_at: run.completedAt ?? null,
      failure_reason: run.failureReason ?? null,
    };
    await this.db
      .insertInto('agent_runs')
      .values(values)
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          status: values.status,
          applied_action_indexes: values.applied_action_indexes,
          reviewed_by: values.reviewed_by,
          reviewed_at: values.reviewed_at,
          completed_at: values.completed_at,
          failure_reason: values.failure_reason,
        }),
      )
      .execute();
    persistState();
  }
}
