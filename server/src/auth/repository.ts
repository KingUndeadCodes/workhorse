import { randomUUID } from 'node:crypto';
import type { User } from '../domain';
import { all, get, run, stateDb } from '../db/core';
import { rowToUser } from '../db/mappers';
import { getWorkspace } from '../queries';

export function findUserByEmail(email: string): User | undefined {
  const row = get(stateDb, `SELECT * FROM users WHERE email = ?`, [email]);
  return row ? rowToUser(row) : undefined;
}

export function getUserById(id: string): User | undefined {
  const row = get(stateDb, `SELECT * FROM users WHERE id = ?`, [id]);
  return row ? rowToUser(row) : undefined;
}

export function getCredentialHash(userId: string): string | undefined {
  const row = get(stateDb, `SELECT password_hash FROM credentials WHERE user_id = ?`, [userId]);
  return row?.password_hash as string | undefined;
}

/**
 * Creates the user + credential rows directly (bypasses emitEvent/the event log — unlike
 * issues/comments/etc., account creation isn't event-sourced yet; a deliberate scope cut
 * for this pass, not an oversight). Caller must call persistState() after.
 */
export async function createUserWithCredentials(email: string, displayName: string, passwordHash: string): Promise<User> {
  const id = `u_${randomUUID()}`;
  const now = new Date().toISOString();
  run(stateDb, `INSERT INTO users (id, kind, email, display_name, avatar_url, status, created_at) VALUES (?, 'human', ?, ?, NULL, 'active', ?)`, [id, email, displayName, now]);
  run(stateDb, `INSERT INTO credentials (user_id, password_hash, created_at) VALUES (?, ?, ?)`, [id, passwordHash, now]);
  // The very first person to ever sign up owns the workspace; everyone after joins as a
  // plain member. No invite flow yet, so this is the only role decision made automatically.
  const isFirstMember = all(stateDb, `SELECT 1 FROM workspace_members LIMIT 1`).length === 0;
  run(stateDb, `INSERT INTO workspace_members (workspace_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)`, [
    (await getWorkspace()).id, id, isFirstMember ? 'owner' : 'member', now,
  ]);
  return { id, kind: 'human', email, displayName, status: 'active', createdAt: now };
}
