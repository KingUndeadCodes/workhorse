/** Entry point: boots both databases, creates the minimal structural rows if `state.db` is brand new (see seed.ts — no sample content), then serves the Hono app (app.ts) on `PORT`, defaulting to 8787. */
import { serve } from '@hono/node-server';
import { app } from './app';
import { initDatabases, persistState, run, stateDb } from './db/core';
import { migrateEventsDb, migrateStateDb } from './db/schema';
import { getWorkspace, listUsers, listWorkspaceMembers } from './queries';
import { bootstrapDatabase } from './seed';

const { isFreshState } = await initDatabases();
migrateStateDb();
migrateEventsDb();
if (isFreshState) bootstrapDatabase();

/**
 * One-time catch-up for accounts created before workspace membership existed: gives every
 * human user with no `workspace_members` row a role, oldest account first as 'owner' so
 * there's always exactly one owner rather than none. New signups get their row directly in
 * `createUserWithCredentials` and never hit this path.
 */
async function backfillWorkspaceMembers(): Promise<void> {
  const existingIds = new Set((await listWorkspaceMembers()).map((m) => m.userId));
  const missing = (await listUsers())
    .filter((u) => u.kind === 'human' && !existingIds.has(u.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (missing.length === 0) return;
  const hasOwner = (await listWorkspaceMembers()).some((m) => m.role === 'owner');
  const workspaceId = (await getWorkspace()).id;
  missing.forEach((u, i) => {
    const role = !hasOwner && i === 0 ? 'owner' : 'member';
    run(stateDb, `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`, [workspaceId, u.id, role, u.createdAt]);
  });
  persistState();
}
await backfillWorkspaceMembers();

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Anvil API listening on http://localhost:${info.port}`);
});
