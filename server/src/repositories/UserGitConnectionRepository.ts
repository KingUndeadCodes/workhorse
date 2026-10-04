import type { Kysely } from 'kysely';
import type { DB } from '../db/types';
import { persistState } from '../db/core';
import { decryptToken, encryptToken } from '../crypto/tokenCipher';
import type { GitAuth, UserGitConnection } from '../domain';

/**
 * Each person's own git-host credentials, one per (user, provider). The secret is encrypted at
 * rest (see crypto/tokenCipher.ts) — every row read/written here crosses that boundary exactly
 * once, so this class is the only place a plaintext git secret touches the database.
 * (`WebhookRepository` applies the same encryption to `WebhookSubscription.secret`.)
 */
export class UserGitConnectionRepository {
  constructor(private readonly db: Kysely<DB>) {}

  /**
   * Encrypts any secret still sitting in plaintext — rows moved here from the old per-project
   * `git_repo_links.token` (see db/schema.ts) keep their original value, which for links created
   * before encryption existed was plaintext. Idempotent; called once at boot.
   */
  async encryptLegacyPlaintext(): Promise<void> {
    const rows = await this.db.selectFrom('user_git_connections').select(['user_id', 'provider', 'token']).execute();
    const legacy = rows.filter((r) => r.token && decryptToken(r.token) === r.token);
    for (const r of legacy) {
      await this.db.updateTable('user_git_connections').set({ token: encryptToken(r.token!) }).where('user_id', '=', r.user_id).where('provider', '=', r.provider).execute();
    }
    if (legacy.length) persistState();
  }

  async get(userId: string, provider: string): Promise<UserGitConnection | undefined> {
    const row = await this.db.selectFrom('user_git_connections').selectAll().where('user_id', '=', userId).where('provider', '=', provider).executeTakeFirst();
    if (!row || !row.token) return undefined;
    const secret = decryptToken(row.token);
    const auth: GitAuth = row.auth_kind === 'oauth' ? { kind: 'oauth', accessToken: secret } : { kind: 'token', token: secret };
    return { userId: row.user_id, provider: row.provider, auth, accountLogin: row.account_login ?? undefined, createdAt: row.created_at ?? '' };
  }

  async listForUser(userId: string): Promise<UserGitConnection[]> {
    const rows = await this.db.selectFrom('user_git_connections').select('provider').where('user_id', '=', userId).execute();
    const all = await Promise.all(rows.map((r) => this.get(userId, r.provider)));
    return all.filter((c): c is UserGitConnection => !!c);
  }

  /** Connecting again replaces the previous connection for that provider. */
  async upsert(connection: UserGitConnection): Promise<void> {
    const secret = connection.auth.kind === 'oauth' ? connection.auth.accessToken : connection.auth.token;
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('user_git_connections').where('user_id', '=', connection.userId).where('provider', '=', connection.provider).execute();
      await trx
        .insertInto('user_git_connections')
        .values({
          user_id: connection.userId,
          provider: connection.provider,
          auth_kind: connection.auth.kind,
          token: encryptToken(secret),
          account_login: connection.accountLogin ?? null,
          created_at: connection.createdAt,
        })
        .execute();
    });
    persistState();
  }

  async delete(userId: string, provider: string): Promise<void> {
    await this.db.deleteFrom('user_git_connections').where('user_id', '=', userId).where('provider', '=', provider).execute();
    persistState();
  }
}
