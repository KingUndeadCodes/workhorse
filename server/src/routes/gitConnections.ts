import { Hono } from 'hono';
import type { GitAuth, UserGitConnection, UserGitConnectionPublic } from '../domain';
import { requireNonGuest, type AuthVariables } from '../auth/middleware';
import { gitProviders, userGitConnectionRepo } from '../container';
import {
  buildAuthorizeUrl, consumeState, exchangeCodeForToken, getGitHubOAuthConfig, isAllowedReturnTo, issueConnectTicket, redeemConnectTicket, signState, verifyState,
} from '../services/githubOAuth';

/**
 * Each person's own git-host connections (their GitHub account) — what an agent uses when it acts
 * on their behalf. Authenticated half; mounted after requireAuth. Secrets never leave the server.
 */
export const gitConnectionsRouter = new Hono<{ Variables: AuthVariables }>();

function toPublic(c: UserGitConnection): UserGitConnectionPublic {
  const { auth, ...rest } = c;
  return { ...rest, authKind: auth.kind };
}

/** GET /api/git-connections -> `{ connections, githubOAuth }` — the caller's connections, and whether the Connect GitHub button can work (GITHUB_OAUTH_* / PUBLIC_URL all set). */
gitConnectionsRouter.get('/git-connections', async (c) => {
  const connections = await userGitConnectionRepo.listForUser(c.get('user').id);
  return c.json({ connections: connections.map(toPublic), githubOAuth: !!getGitHubOAuthConfig() });
});

/** Verifies the credential belongs to a real account (via the provider's `identify`), then stores it as the caller's connection. */
async function saveConnection(userId: string, provider: string, auth: GitAuth): Promise<UserGitConnection> {
  const p = gitProviders.resolve(provider);
  if (!p.identify) throw new Error(`"${provider}" does not use account connections`);
  const { login } = await p.identify(auth);
  const connection: UserGitConnection = { userId, provider, auth, accountLogin: login, createdAt: new Date().toISOString() };
  await userGitConnectionRepo.upsert(connection);
  return connection;
}

/** PUT /api/git-connections/:provider — body `{ token }`: connect with a pasted personal access token. */
gitConnectionsRouter.put('/git-connections/:provider', async (c) => {
  const forbidden = await requireNonGuest(c, 'connect a git account');
  if (forbidden) return c.json({ error: forbidden }, 403);
  const body = await c.req.json<{ token: string }>();
  if (!body.token?.trim()) return c.json({ error: 'token is required' }, 400);
  try {
    return c.json(toPublic(await saveConnection(c.get('user').id, c.req.param('provider'), { kind: 'token', token: body.token.trim() })));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/** GET /api/git-connections/:provider/repos -> GitRepoSummary[] — the repos the caller's own connected account can reach (the repo picker's source). 400 if they haven't connected one. */
gitConnectionsRouter.get('/git-connections/:provider/repos', async (c) => {
  const provider = c.req.param('provider');
  const p = gitProviders.list().find((g) => g.id === provider);
  if (!p) return c.json({ error: `No git provider registered for "${provider}"` }, 404);
  if (!p.listRepos) return c.json({ error: `"${provider}" cannot list repositories` }, 400);
  const connection = await userGitConnectionRepo.get(c.get('user').id, provider);
  if (!connection) return c.json({ error: `Connect your ${provider} account first (Settings → Git)` }, 400);
  try {
    return c.json(await p.listRepos(connection.auth));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

/** DELETE /api/git-connections/:provider — disconnects the caller's account. */
gitConnectionsRouter.delete('/git-connections/:provider', async (c) => {
  await userGitConnectionRepo.delete(c.get('user').id, c.req.param('provider'));
  return c.json({ ok: true });
});

/**
 * POST /api/git-connections/github/oauth/start — body `{ returnTo }`. Returns `{ url }`: GitHub's
 * authorize URL, which the client navigates to. A POST (not a bare redirect route) because a
 * browser navigation can't carry the bearer token.
 */
gitConnectionsRouter.post('/git-connections/github/oauth/start', async (c) => {
  const forbidden = await requireNonGuest(c, 'connect a git account');
  if (forbidden) return c.json({ error: forbidden }, 403);
  const config = getGitHubOAuthConfig();
  if (!config) return c.json({ error: 'GitHub OAuth is not configured on this server' }, 400);

  const body = await c.req.json<{ returnTo: string }>();
  let returnTo: URL;
  try {
    returnTo = new URL(body.returnTo);
    if (returnTo.protocol !== 'http:' && returnTo.protocol !== 'https:') throw new Error();
  } catch {
    return c.json({ error: 'returnTo must be an http(s) URL' }, 400);
  }
  if (!isAllowedReturnTo(returnTo)) {
    return c.json({ error: "returnTo must be on this app's own origin (set APP_URL if the app is served from a different origin than PUBLIC_URL)" }, 400);
  }
  return c.json({ url: buildAuthorizeUrl(config, signState({ userId: c.get('user').id, returnTo: returnTo.toString() })) });
});

/** Public half: GitHub redirects the browser here, so no bearer token — the signed `state` is what authorizes it. Mounted before requireAuth. */
export const gitConnectionsCallbackRouter = new Hono();

/**
 * POST /api/git-connections/github/oauth/complete — body `{ ticket }`. Finishes the flow *as the
 * signed-in caller*: the ticket must have been issued for them. This is what stops a victim who is
 * tricked into approving an attacker's authorize URL from having their token saved to the
 * attacker's account — the victim's own session redeems the ticket, and it names someone else.
 */
gitConnectionsRouter.post('/git-connections/github/oauth/complete', async (c) => {
  const forbidden = await requireNonGuest(c, 'connect a git account');
  if (forbidden) return c.json({ error: forbidden }, 403);
  const body = await c.req.json<{ ticket: string }>();
  const accessToken = typeof body.ticket === 'string' ? redeemConnectTicket(body.ticket, c.get('user').id) : undefined;
  if (!accessToken) return c.json({ error: 'This connect attempt is invalid or has expired — start again' }, 400);
  try {
    return c.json(toPublic(await saveConnection(c.get('user').id, 'github', { kind: 'oauth', accessToken })));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }
});

/**
 * GET /api/git-connections/github/oauth/callback?code&state. Verifies the state (signed, unexpired,
 * not already used), exchanges the code, and parks the token behind a one-time ticket — it does
 * *not* save anything, since this public route can't tell who is at the keyboard (see
 * {@link issueConnectTicket}). Redirects back to the app with `?gitConnect=ready&ticket=` for the
 * signed-in SPA to redeem via `/oauth/complete`, or `?gitConnect=error&message=`.
 */
gitConnectionsCallbackRouter.get('/git-connections/github/oauth/callback', async (c) => {
  const config = getGitHubOAuthConfig();
  if (!config) return c.text('GitHub OAuth is not configured on this server', 400);

  let state;
  try {
    state = verifyState(c.req.query('state') ?? '');
  } catch (err) {
    return c.text(err instanceof Error ? err.message : 'Invalid OAuth state', 400);
  }

  if (!consumeState(state)) return c.text('This connect attempt was already used — start again', 400);

  const back = (result: { ticket: string } | { error: string }) => {
    const url = new URL(state.returnTo);
    if ('ticket' in result) {
      url.searchParams.set('gitConnect', 'ready');
      url.searchParams.set('ticket', result.ticket);
    } else {
      url.searchParams.set('gitConnect', 'error');
      url.searchParams.set('message', result.error);
    }
    return c.redirect(url.toString());
  };

  const code = c.req.query('code');
  if (!code) return back({ error: c.req.query('error_description') || 'GitHub authorization was cancelled' });

  try {
    const accessToken = await exchangeCodeForToken(config, code);
    return back({ ticket: issueConnectTicket(state.userId, accessToken) });
  } catch (err) {
    return back({ error: err instanceof Error ? err.message : String(err) });
  }
});
