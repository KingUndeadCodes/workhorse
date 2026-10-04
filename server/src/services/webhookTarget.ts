/**
 * Keeps outbound webhooks from being used to reach things only the server can reach. A webhook target is
 * a URL any non-guest member types in, and the server then POSTs every event to it — so without limits it
 * is a request-forgery tool: `http://169.254.169.254/…` (cloud metadata), `http://localhost:5432`, or any
 * internal host, with each delivery's status code readable back through the deliveries endpoint (which
 * also makes it a port scanner).
 *
 * Three layers, because each alone leaves a gap:
 *   1. {@link validateWebhookUrl} — https only, no embedded credentials, no `localhost`-style names, no
 *      literal private IPs. Runs when a hook is created/edited and again on every delivery.
 *   2. {@link safeLookup} — the DNS lookup the delivery connection itself uses, which refuses a hostname
 *      that resolves to a private address. Because it runs at connect time, a name that was public when
 *      the hook was saved (or checked a moment ago) can't later be re-pointed at an internal address
 *      ("DNS rebinding") — there's no gap between checking and connecting.
 *   3. Redirects aren't followed (see EventEngine.deliverToWebhook), since a public URL could otherwise
 *      bounce the request to an internal one.
 *
 * `WEBHOOK_ALLOW_PRIVATE=1` lifts all of it, for local development against a receiver on this machine.
 * It is an explicit opt-in and should never be set on an internet-facing deployment.
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent } from 'undici';

export function allowPrivateWebhookTargets(): boolean {
  return process.env.WEBHOOK_ALLOW_PRIVATE === '1';
}

const blocked = new BlockList();
// IPv4: "this network", private, CGNAT, loopback, link-local (incl. cloud metadata), IETF/benchmark/test nets, multicast & reserved.
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
// IPv6: unspecified, loopback, unique-local, link-local, multicast, documentation.
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** True for any address that isn't a plain public-internet address (including IPv4 hidden inside an IPv6 form). */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true; // not an IP at all — never treat unparseable as safe
  if (family === 4) return blocked.check(address, 'ipv4');
  const lower = address.toLowerCase();
  // ::ffff:a.b.c.d (IPv4-mapped) and 64:ff9b::a.b.c.d (NAT64) carry an IPv4 address that must be judged as IPv4.
  const embedded = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (embedded) return blocked.check(embedded, 'ipv4');
  const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1], 16);
    const lo = parseInt(hexMapped[2], 16);
    return blocked.check(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`, 'ipv4');
  }
  return blocked.check(address, 'ipv6');
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

/** Throws a message safe to show the user if `raw` isn't an acceptable webhook target. Returns the parsed URL. */
export function validateWebhookUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('targetUrl must be a valid URL');
  }
  const allowPrivate = allowPrivateWebhookTargets();
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) throw new Error('targetUrl must use https://');
  if (url.username || url.password) throw new Error('targetUrl must not contain credentials');
  if (allowPrivate) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (LOCAL_NAME.test(host)) throw new Error('targetUrl must not point at a local or internal host');
  if (isIP(host) !== 0 && isPrivateAddress(host)) throw new Error('targetUrl must not point at a private or internal address');
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup for the delivery connection: resolves normally, then refuses if *any* answer is a private address. */
export function safeLookup(hostname: string, options: { all?: boolean; family?: number; hints?: number }, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '' as never);
    const list = addresses as LookupAddress[];
    if (!allowPrivateWebhookTargets() && list.some((a) => isPrivateAddress(a.address))) {
      const blockedErr: NodeJS.ErrnoException = new Error(`"${hostname}" resolves to a private or internal address`);
      blockedErr.code = 'EBLOCKED';
      return callback(blockedErr, '' as never);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

let agent: Agent | undefined;
/** The undici dispatcher webhook deliveries go through — same as `fetch`'s default, but with {@link safeLookup} as its resolver. */
export function webhookDispatcher(): Agent {
  return (agent ??= new Agent({ connect: { lookup: safeLookup as never }, headersTimeout: 10_000, bodyTimeout: 10_000 }));
}
