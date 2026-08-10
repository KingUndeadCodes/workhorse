import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { rowToUser } from '../db/mappers';
import type { User } from '../domain';

/** Reads/writes for `users` + `credentials`. Credentials live in a separate table on purpose
 * — see schema.ts — so a stray `SELECT *` against `users` can never leak a password hash. */
export class UserRepository {
  constructor(private readonly db: Kysely<DB>) {}

  async list(): Promise<User[]> {
    return (await this.db.selectFrom('users').selectAll().execute()).map(rowToUser);
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const row = await this.db.selectFrom('users').selectAll().where('email', '=', email).executeTakeFirst();
    return row ? rowToUser(row) : undefined;
  }

  async getById(id: string): Promise<User | undefined> {
    const row = await this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? rowToUser(row) : undefined;
  }

  async getCredentialHash(userId: string): Promise<string | undefined> {
    const row = await this.db.selectFrom('credentials').select('password_hash').where('user_id', '=', userId).executeTakeFirst();
    return row?.password_hash;
  }

  /** Creates a human account with a credential row. Does not touch workspace membership — see {@link WorkspaceRepository.addMember}. */
  async createHuman(email: string, displayName: string, passwordHash: string): Promise<User> {
    const id = `u_${randomUUID()}`;
    const now = new Date().toISOString();
    await this.db.insertInto('users').values({ id, kind: 'human', email, display_name: displayName, avatar_url: null, status: 'active', created_at: now }).execute();
    await this.db.insertInto('credentials').values({ user_id: id, password_hash: passwordHash, created_at: now }).execute();
    persistState();
    return { id, kind: 'human', email, displayName, status: 'active', createdAt: now };
  }

  /** Creates the synthetic user row an {@link Agent} rides on top of — see AgentRepository. */
  async createAgentUser(id: string, email: string, displayName: string, createdAt: string): Promise<void> {
    await this.db.insertInto('users').values({ id, kind: 'agent', email, display_name: displayName, avatar_url: null, status: 'active', created_at: createdAt }).execute();
  }

  /**
   * Updates the caller's own profile — display name, email, and/or avatar. `avatarUrl` is
   * a data: URL (the client resizes/encodes the picture client-side before sending it —
   * there's no file-upload storage in this prototype, same trade-off attachments already
   * make with client-hosted URLs) or `null` to remove the picture.
   */
  async updateProfile(userId: string, changes: { displayName?: string; email?: string; avatarUrl?: string | null }): Promise<User | undefined> {
    const existing = await this.getById(userId);
    if (!existing) return undefined;
    const set: Record<string, unknown> = {};
    if (changes.displayName !== undefined) set.display_name = changes.displayName;
    if (changes.email !== undefined) set.email = changes.email;
    if (changes.avatarUrl !== undefined) set.avatar_url = changes.avatarUrl;
    if (Object.keys(set).length > 0) {
      await this.db.updateTable('users').set(set as never).where('id', '=', userId).execute();
      persistState();
    }
    return this.getById(userId);
  }
}
