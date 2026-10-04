import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPrivateAddress, safeLookup, validateWebhookUrl } from '../src/services/webhookTarget';
import { createTestEngine, seedHumanUser, seedIssue, seedWorkflow, seedWorkspace, waitFor } from './helpers';

vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>();
  // Pretend a hostname resolves wherever the test says, so DNS rebinding can be simulated without a network.
  const answers: Record<string, string[]> = { 'rebind.example': ['10.0.0.5'], 'mixed.example': ['93.184.216.34', '169.254.169.254'], 'public.example': ['93.184.216.34'] };
  const lookup = (host: string, opts: unknown, cb: (e: Error | null, a: unknown) => void) => {
    const list = answers[host];
    if (!list) return actual.lookup(host, opts as never, cb as never);
    cb(null, list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  };
  return { ...actual, lookup };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::169.254.169.254', 'not-an-ip', '',
  ])('%s is private/internal', (address) => expect(isPrivateAddress(address)).toBe(true));

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.255.255', '192.169.0.1', '11.0.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    '%s is public',
    (address) => expect(isPrivateAddress(address)).toBe(false),
  );
});

describe('validateWebhookUrl', () => {
  it('accepts an ordinary https URL', () => {
    expect(validateWebhookUrl('https://hooks.example.com/workhorse?x=1').hostname).toBe('hooks.example.com');
    expect(validateWebhookUrl('https://93.184.216.34/hook').hostname).toBe('93.184.216.34');
  });

  it.each([
    ['plain http', 'http://hooks.example.com/x', /https/],
    ['cloud metadata', 'https://169.254.169.254/latest/meta-data/', /private or internal/],
    ['loopback literal', 'https://127.0.0.1:8787/api', /private or internal/],
    ['IPv6 loopback', 'https://[::1]/x', /private or internal/],
    ['IPv4-mapped IPv6', 'https://[::ffff:10.0.0.1]/x', /private or internal/],
    ['RFC1918', 'https://192.168.0.10/x', /private or internal/],
    ['localhost', 'https://localhost/x', /local or internal/],
    ['*.localhost', 'https://app.localhost/x', /local or internal/],
    ['*.internal', 'https://metadata.google.internal/x', /local or internal/],
    ['*.local', 'https://printer.local/x', /local or internal/],
    ['embedded credentials', 'https://user:pass@hooks.example.com/x', /credentials/],
    ['a non-URL', 'not a url', /valid URL/],
    ['another scheme', 'file:///etc/passwd', /https/],
    ['ftp', 'ftp://example.com/x', /https/],
  ])('rejects %s', (_label, url, message) => expect(() => validateWebhookUrl(url)).toThrow(message));

  it('WEBHOOK_ALLOW_PRIVATE=1 is the explicit opt-in for local development: allows http and private targets', () => {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE', '1');
    expect(() => validateWebhookUrl('http://localhost:9000/hook')).not.toThrow();
    expect(() => validateWebhookUrl('http://127.0.0.1:9000/hook')).not.toThrow();
    expect(() => validateWebhookUrl('ftp://127.0.0.1/hook')).toThrow(/https/); // still only web schemes
    expect(() => validateWebhookUrl('https://user:pw@127.0.0.1/hook')).toThrow(/credentials/);
  });
});

describe('safeLookup (the connection-time check that defeats DNS rebinding)', () => {
  const resolve = (host: string, all = false) =>
    new Promise<unknown>((ok, fail) => safeLookup(host, { all }, (err, address, family) => (err ? fail(err) : ok(all ? address : { address, family }))));

  it('refuses a name that resolves to a private address, even though the URL itself looked fine', async () => {
    await expect(resolve('rebind.example')).rejects.toMatchObject({ code: 'EBLOCKED', message: expect.stringMatching(/private or internal/) });
  });

  it('refuses if ANY answer is private (a public record next to an internal one is still a bypass)', async () => {
    await expect(resolve('mixed.example')).rejects.toMatchObject({ code: 'EBLOCKED' });
    await expect(resolve('mixed.example', true)).rejects.toMatchObject({ code: 'EBLOCKED' });
  });

  it('lets a public name through, in both the single and all-answers forms', async () => {
    expect(await resolve('public.example')).toEqual({ address: '93.184.216.34', family: 4 });
    expect(await resolve('public.example', true)).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('refuses localhost by real resolution', async () => {
    await expect(resolve('localhost')).rejects.toMatchObject({ code: 'EBLOCKED' });
  });

  it('WEBHOOK_ALLOW_PRIVATE=1 lets a private resolution through', async () => {
    vi.stubEnv('WEBHOOK_ALLOW_PRIVATE', '1');
    expect(await resolve('rebind.example')).toEqual({ address: '10.0.0.5', family: 4 });
  });
});

describe('webhook delivery', () => {
  async function setup() {
    const { db } = await import('../src/db/core');
    await seedWorkspace(db);
    await seedWorkflow(db);
    const { engine, userRepo, issueRepo, webhookRepo, webhookDeliveryRepo } = createTestEngine(db);
    const reporter = await seedHumanUser(userRepo, 'reporter@example.com', 'Reporter');
    const issue = await seedIssue(issueRepo, { reporterId: reporter.id });
    const hook = (targetUrl: string) => webhookRepo.create({ id: 'hook_1', workspaceId: 'ws_test', targetUrl, secret: 'shh', eventFilter: '*', enabled: true, createdBy: reporter.id });
    const fire = () =>
      engine.emitEvent({
        actor: { kind: 'user', userId: reporter.id },
        subject: { type: 'issue', id: issue.id },
        payload: { type: 'issue.statusChanged', issueId: issue.id, fromStatusId: 'st_todo', toStatusId: 'st_inprogress' },
      });
    const deliveries = () => waitFor(() => webhookDeliveryRepo.listForWebhook('hook_1', 20, 0).then((r) => r.deliveries));
    return { hook, fire, deliveries };
  }

  it('signs `<timestamp>.<body>` and sends the timestamp, so a captured delivery cannot be replayed later', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { hook, fire, deliveries } = await setup();
    await hook('https://hooks.example.com/x');

    await fire();
    await deliveries();

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit & { headers: Record<string, string>; body: string }];
    const timestamp = init.headers['x-anvil-timestamp'];
    expect(Math.abs(Number(timestamp) - Date.now() / 1000)).toBeLessThan(5);
    expect(init.headers['x-anvil-signature']).toBe(createHmac('sha256', 'shh').update(`${timestamp}.${init.body}`).digest('hex'));
    expect(init.headers['x-anvil-signature']).not.toBe(createHmac('sha256', 'shh').update(init.body).digest('hex')); // not the old body-only form
  });

  it('does not follow redirects (a public URL could bounce the request to an internal one) and records it as a failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { hook, fire, deliveries } = await setup();
    await hook('https://hooks.example.com/x');

    await fire();
    const [delivery] = await deliveries();

    expect((fetchMock.mock.calls[0][1] as RequestInit).redirect).toBe('manual');
    expect(delivery).toMatchObject({ status: 'failure', statusCode: 302, error: 'Redirects are not followed' });
  });

  it.each(['https://169.254.169.254/latest/meta-data/', 'https://127.0.0.1:8787/api/auth/login', 'https://localhost/x', 'http://hooks.example.com/x'])(
    'refuses to deliver to %s — no request is made, and the reason is recorded',
    async (target) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);
      const { hook, fire, deliveries } = await setup();
      await hook(target); // e.g. a hook saved before these rules existed

      await fire();
      const [delivery] = await deliveries();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(delivery.status).toBe('failure');
      expect(delivery.statusCode).toBeUndefined();
      expect(delivery.error).toMatch(/must/);
    },
  );

  it('delivers through the guarded dispatcher', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { hook, fire, deliveries } = await setup();
    await hook('https://hooks.example.com/x');

    await fire();
    await deliveries();

    expect((fetchMock.mock.calls[0][1] as { dispatcher?: unknown }).dispatcher).toBeDefined();
  });
});
