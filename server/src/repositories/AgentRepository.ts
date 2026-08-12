import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToAgent } from '../db/mappers';
import type { Agent } from '../domain';

/** Reads/writes for agent *definitions*. Execution lives in {@link EventEngine}. */
export class AgentRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async list(): Promise<Agent[]> {
    return (await this.db.selectFrom('agents').selectAll().execute()).map(rowToAgent);
  }

  async get(userId: string): Promise<Agent | undefined> {
    const row = await this.db.selectFrom('agents').selectAll().where('user_id', '=', userId).executeTakeFirst();
    return row ? rowToAgent(row) : undefined;
  }

  async create(agent: Agent): Promise<void> {
    await this.db
      .insertInto('agents')
      .values({
        user_id: agent.userId,
        workspace_id: agent.workspaceId,
        project_id: agent.projectId,
        name: agent.name,
        description: agent.description ?? null,
        enabled: agent.enabled ? 1 : 0,
        model: agent.model,
        event_filter: JSON.stringify(agent.eventFilter),
        allowed_action_types: JSON.stringify(agent.allowedActionTypes),
        approval_policy: JSON.stringify(agent.approvalPolicy),
        budget: JSON.stringify(agent.budget),
        ignore_self_triggered_events: agent.ignoreSelfTriggeredEvents ? 1 : 0,
        created_at: agent.createdAt,
      })
      .execute();
    persistState();
  }

  async update(agent: Agent): Promise<void> {
    await this.db
      .updateTable('agents')
      .set({
        name: agent.name,
        description: agent.description ?? null,
        enabled: agent.enabled ? 1 : 0,
        model: agent.model,
        event_filter: JSON.stringify(agent.eventFilter),
        allowed_action_types: JSON.stringify(agent.allowedActionTypes),
        approval_policy: JSON.stringify(agent.approvalPolicy),
        budget: JSON.stringify(agent.budget),
        ignore_self_triggered_events: agent.ignoreSelfTriggeredEvents ? 1 : 0,
      })
      .where('user_id', '=', agent.userId)
      .execute();
    persistState();
  }
}
