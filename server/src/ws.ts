/**
 * Live updates: every event this app appends to its log (see EventEngine.writeEvent) is
 * broadcast, verbatim, to every browser tab connected here for that event's workspace. The
 * frontend applies each one to its already-loaded Svelte stores directly (see app/src/lib/ws.ts)
 * instead of polling or waiting for a manual reload to see what someone else — a teammate, an
 * automation, an agent — just did.
 *
 * Deliberately thin: this file only tracks sockets and fans out messages. It has no idea what
 * an event *means* — same separation EventEngine already draws between "append to the log" and
 * "react to what was appended."
 */
import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { ServerType } from '@hono/node-server';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyToken, type AuthClaims } from './auth/jwt';
import { workspaceRepo } from './container';
import type { EventEnvelope } from './domain';

const WS_PATH = '/ws';
const HEARTBEAT_INTERVAL_MS = 30_000;

interface Client {
  ws: WebSocket;
  workspaceId: string;
  /** The authenticated user this socket belongs to — lets {@link broadcastToUser} target one
   *  recipient (e.g. a new notification) the same infrastructure {@link broadcastEvent} uses
   *  to reach everyone in a workspace. */
  userId: string;
  alive: boolean;
}

const clients = new Set<Client>();

/**
 * Attaches a WebSocket server to the same HTTP server Hono is already listening on — one
 * port, one process, no separate service to run. `serve()`'s return type also covers an
 * HTTP/2 server (if `serve()` were ever called with HTTP/2 options, which index.ts doesn't),
 * which `ws`'s types don't accept — the cast reflects that this app only ever runs over plain
 * HTTP/1.1, not a real type mismatch.
 */
export function initWebSocketServer(httpServer: ServerType): void {
  const wss = new WebSocketServer({ server: httpServer as HttpServer, path: WS_PATH });

  wss.on('connection', async (ws, req: IncomingMessage) => {
    // The browser's native WebSocket API can't set an Authorization header, so the token
    // travels as a query param instead — the same tradeoff the OAuth "start" redirect
    // discussion earlier ruled out for a full JWT, but here there's no alternative: this is
    // the literal-only mechanism the browser's WebSocket constructor exposes.
    const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token');
    if (!token) return ws.close(4001, 'Missing token');

    let claims: AuthClaims;
    try {
      claims = await verifyToken(token);
    } catch {
      return ws.close(4001, 'Invalid token');
    }
    // Every event this app emits carries a workspaceId, and there's exactly one workspace per
    // deployment today (see seed.ts) — a real multi-workspace membership check would look up
    // which workspace(s) the verified user belongs to; not needed yet since nothing else in
    // this codebase enforces that boundary either.
    const workspaceId = (await workspaceRepo.getWorkspace()).id;

    const client: Client = { ws, workspaceId, userId: claims.sub, alive: true };
    clients.add(client);
    ws.on('pong', () => (client.alive = true));
    ws.on('close', () => clients.delete(client));
    ws.on('error', () => clients.delete(client));
  });

  // Dead-connection cleanup — a socket that stops responding to pings (network drop, laptop
  // sleep) is closed and removed rather than silently accumulating forever.
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.ws.terminate();
        clients.delete(client);
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  wss.on('close', () => clearInterval(heartbeat));
}

/** Sends `event` to every connected client in `event.workspaceId`. Called once per event, right after it's appended — see EventEngine.writeEvent. Wrapped with a top-level `kind: 'event'` tag — see {@link broadcastToUser}'s doc comment for why both message shapes need an explicit, always-present discriminant rather than distinguishing them by field presence. */
export function broadcastEvent(event: EventEnvelope): void {
  const payload = JSON.stringify({ kind: 'event', event });
  for (const client of clients) {
    if (client.workspaceId === event.workspaceId && client.ws.readyState === client.ws.OPEN) {
      client.ws.send(payload);
    }
  }
}

/**
 * Sends `message` to every connected socket belonging to `userId` (a user can have more than
 * one tab open) — the one-recipient counterpart to {@link broadcastEvent}'s whole-workspace
 * fan-out. Used by `EventEngine.notifyRecipients` to push a freshly created notification live,
 * the same "no polling" guarantee every other live update already gets. The message is
 * wrapped with a top-level `kind: 'notification'` discriminator — {@link broadcastEvent}'s
 * messages carry `kind: 'event'` the same way, so the frontend's single message handler always
 * has an explicit tag to switch on instead of inferring the shape from which fields happen to
 * be present.
 */
export function broadcastToUser(userId: string, message: unknown): void {
  const payload = JSON.stringify(message);
  for (const client of clients) {
    if (client.userId === userId && client.ws.readyState === client.ws.OPEN) {
      client.ws.send(payload);
    }
  }
}
