import { Hono } from 'hono';
import type { GitAuth, UserGitConnection, UserGitConnectionPublic } from '../domain';
import { requireNonGuest, type AuthVariables } from '../auth/middleware';
import { gitProviders, userGitConnectionRepo } from '../container';
import { buildAuthorizeUrl, exchangeCodeForToken, getGitHubOAuthConfig, signState, verifyState } from '../services/githubOAuth';

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
  return c.json({ url: buildAuthorizeUrl(config, signState({ userId: c.get('user').id, returnTo: returnTo.toString() })) });
});

/** Public half: GitHub redirects the browser here, so no bearer token — the signed `state` is what authorizes it. Mounted before requireAuth. */
export const gitConnectionsCallbackRouter = new Hono();

/**
 * GET /api/git-connections/github/oauth/callback?code&state. Exchanges the code, identifies the
 * GitHub account, saves it as the state's user's connection, then redirects the browser back to the
 * page that started the flow with `?gitConnect=ok` or `?gitConnect=error&message=`.
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

  const back = (result: 'ok' | { error: string }) => {
    const url = new URL(state.returnTo);
    url.searchParams.set('gitConnect', result === 'ok' ? 'ok' : 'error');
    if (result !== 'ok') url.searchParams.set('message', result.error);
    return c.redirect(url.toString());
  };

  const code = c.req.query('code');
  if (!code) return back({ error: c.req.query('error_description') || 'GitHub authorization was cancelled' });

  try {
    const accessToken = await exchangeCodeForToken(config, code);
    await saveConnection(state.userId, 'github', { kind: 'oauth', accessToken });
    return back('ok');
  } catch (err) {
    return back({ error: err instanceof Error ? err.message : String(err) });
  }
});
