import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToAutomationRule } from '../db/mappers';
import type { AutomationRule } from '../domain';

/** CRUD for automation rule definitions. Execution lives in {@link EventEngine}, run against every emitted event. */
export class AutomationRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async list(): Promise<AutomationRule[]> {
    return (await this.db.selectFrom('automation_rules').selectAll().execute()).map(rowToAutomationRule);
  }

  async create(rule: AutomationRule): Promise<AutomationRule> {
    await this.db
      .insertInto('automation_rules')
      .values({
        id: rule.id,
        project_id: rule.projectId,
        name: rule.name,
        enabled: rule.enabled ? 1 : 0,
        event_filter: JSON.stringify(rule.eventFilter),
        conditions: JSON.stringify(rule.conditions),
        actions: JSON.stringify(rule.actions),
      })
      .execute();
    persistState();
    return rule;
  }

  async update(id: string, changes: Partial<AutomationRule>): Promise<AutomationRule | undefined> {
    const existing = (await this.list()).find((r) => r.id === id);
    if (!existing) return undefined;
    const merged: AutomationRule = { ...existing, ...changes };
    await this.db
      .updateTable('automation_rules')
      .set({
        name: merged.name,
        enabled: merged.enabled ? 1 : 0,
        event_filter: JSON.stringify(merged.eventFilter),
        conditions: JSON.stringify(merged.conditions),
        actions: JSON.stringify(merged.actions),
      })
      .where('id', '=', id)
      .execute();
    persistState();
    return merged;
  }

  async delete(id: string): Promise<void> {
    await this.db.deleteFrom('automation_rules').where('id', '=', id).execute();
    persistState();
  }
}
