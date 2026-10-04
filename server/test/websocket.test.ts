import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { hashPassword } from '../src/auth/password';
import { seedWorkflow, seedWorkspace } from './helpers';

vi.stubEnv('JWT_SECRET', 'test-jwt-secret');
vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'test-encryption-key');

const servers: Server[] = [];
const sockets: WebSocket[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const s of sockets.splice(0)) s.terminate();
  for (const s of servers.splice(0)) s.close();
});

async function boot() {
  const { db } = await import('../src/db/core');
  const workspaceId = await seedWorkspace(db);
  await seedWorkflow(db);
  const container = await import('../src/container');
  container.initContainer();
  const { signToken } = await import('../src/auth/jwt');
  const { app } = await import('../src/app');
  const ws = await import('../src/ws');

  const server = createServer();
  servers.push(server);
  ws.initWebSocketServer(server as never);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  const person = async (role: 'owner' | 'member') => {
    const user = await container.userRepo.createHuman(`${role}@example.com`, role, await hashPassword('pw'));
    await container.workspaceRepo.addMember(workspaceId, user.id, role, new Date().toISOString());
    const token = await signToken(user);
    const api = (path: string, init: { method?: string } = {}) => app.request(`/api${path}`, { method: init.method ?? 'GET', headers: { authorization: `Bearer ${token}` } });
    const ticket = async () => ((await (await api('/ws-ticket', { method: 'POST' })).json()) as { ticket: string }).ticket;
    return { id: user.id, token, api, ticket };
  };
  const owner = await person('owner');
  const member = await person('member');

  /**
   * Opens a socket and resolves with how it ended up: 'open', or the close code the server sent. The server
   * authenticates *after* the handshake (it has to look the user up), so a rejected client still sees `open`
   * first and is closed a few milliseconds later — hence the short grace period before calling it open.
   */
  const connect = (query: string) =>
    new Promise<{ result: 'open' | number; socket: WebSocket; closed: Promise<number> }>((resolve) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws${query}`);
      sockets.push(socket);
      let settled = false;
      const settle = (result: 'open' | number) => {
        if (settled) return;
        settled = true;
        resolve({ result, socket, closed });
      };
      const closed = new Promise<number>((r) => socket.on('close', (code) => (settle(code), r(code))));
      socket.on('open', () => setTimeout(() => settle('open'), 150));
      socket.on('error', () => {});
    });
  const received = (socket: WebSocket) => {
    const messages: unknown[] = [];
    socket.on('message', (m) => messages.push(JSON.parse(m.toString())));
    return messages;
  };
  return { container, ws, owner, member, connect, received, workspaceId };
}

describe('POST /api/ws-ticket', () => {
  it('requires a signed-in caller', async () => {
    const { owner } = await boot();
    const { app } = await import('../src/app');
    expect((await app.request('/api/ws-ticket', { method: 'POST' })).status).toBe(401);
    expect(await owner.ticket()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a removed member cannot get one (their still-valid JWT no longer authenticates)', async () => {
    const { owner, member } = await boot();
    await owner.api(`/workspace-members/${member.id}`, { method: 'DELETE' });
    expect((await member.api('/ws-ticket', { method: 'POST' })).status).toBe(401);
  });
});

describe('websocket authentication', () => {
  it('opens with a fresh ticket, and each ticket works exactly once', async () => {
    const { member, connect } = await boot();
    const ticket = await member.ticket();

    const first = await connect(`?ticket=${ticket}`);
    expect(first.result).toBe('open');
    expect((await connect(`?ticket=${ticket}`)).result).toBe(4001); // replayed
  });

  it('rejects a missing, made-up, or expired ticket with 4001', async () => {
    const { member, connect } = await boot();
    expect((await connect('')).result).toBe(4001);
    expect((await connect('?ticket=not-a-real-ticket')).result).toBe(4001);

    const ticket = await member.ticket();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31_000);
    expect((await connect(`?ticket=${ticket}`)).result).toBe(4001);
  });

  it('no longer accepts the long-lived JWT in the URL — that is the whole point of tickets', async () => {
    const { member, connect } = await boot();
    expect((await connect(`?token=${encodeURIComponent(member.token)}`)).result).toBe(4001);
    expect((await connect(`?ticket=${encodeURIComponent(member.token)}`)).result).toBe(4001);
  });

  it('refuses a ticket for someone who is no longer a member (4003)', async () => {
    const { owner, member, connect } = await boot();
    const ticket = await member.ticket(); // issued while they were still a member
    await owner.api(`/workspace-members/${member.id}`, { method: 'DELETE' });
    expect((await connect(`?ticket=${ticket}`)).result).toBe(4003);
  });
});

describe('removing a member drops their live connection', () => {
  it('closes an already-open socket with 4003, and stops sending them events', async () => {
    const { owner, member, connect, received, ws, workspaceId } = await boot();
    const memberSock = await connect(`?ticket=${await member.ticket()}`);
    const ownerSock = await connect(`?ticket=${await owner.ticket()}`);
    const memberMessages = received(memberSock.socket);
    const ownerMessages = received(ownerSock.socket);
    const event = { id: 'e1', workspaceId, sequence: 1, occurredAt: '', actor: { kind: 'system' }, subject: { type: 'issue', id: 'i' }, payload: { type: 'issue.created', issueId: 'i' } } as never;

    ws.broadcastEvent(event);
    await vi.waitFor(() => expect(memberMessages).toHaveLength(1));
    expect(ownerMessages).toHaveLength(1);

    expect((await owner.api(`/workspace-members/${member.id}`, { method: 'DELETE' })).status).toBe(200);

    expect(await memberSock.closed).toBe(4003);
    ws.broadcastEvent(event);
    await vi.waitFor(() => expect(ownerMessages).toHaveLength(2));
    expect(memberMessages).toHaveLength(1); // nothing more reached the removed member
    expect(ownerSock.socket.readyState).toBe(WebSocket.OPEN); // everyone else is unaffected
  });
});
