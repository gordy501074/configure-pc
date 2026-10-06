// SSRF protection for server-side image downloads.
//
// A model may return arbitrary URLs, so before fetching we enforce:
//   - `https:` only (no http/file/data/gopher/...),
//   - no embedded credentials,
//   - the hostname is not an obvious internal name (localhost, *.internal, ...),
//   - literal IPs and every DNS-resolved address are public (no loopback,
//     private, link-local, CGNAT, multicast, reserved, metadata ranges).
//
// The resolver guard is intentionally conservative: if ANY resolved address is
// non-public, the URL is rejected (DNS-rebinding resistant in the common case).

import { lookup } from "node:dns/promises";

/** Hostnames that must never be fetched even before DNS resolution. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inRange(value: number, base: string, prefix: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseInt & mask);
}

/** True for IPv4 addresses that must not be reached by an outbound fetch. */
export function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // unparseable -> treat as unsafe
  const ranges: Array<[string, number]> = [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10], // CGNAT
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local (incl. 169.254.169.254 metadata)
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved (includes 255.255.255.255)
  ];
  return ranges.some(([base, prefix]) => inRange(value, base, prefix));
}

/** Expand an IPv6 address (including `::` compression) into 8 16-bit groups. */
function parseIpv6(ip: string): number[] | null {
  let address = ip;
  const zone = address.indexOf("%");
  if (zone >= 0) address = address.slice(0, zone);
  let ipv4Tail: number[] | null = null;
  const lastColon = address.lastIndexOf(":");
  if (address.includes(".") && lastColon >= 0) {
    const tail = address.slice(lastColon + 1);
    const v4 = ipv4ToInt(tail);
    if (v4 === null) return null;
    ipv4Tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    address = address.slice(0, lastColon);
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  let groups = [...head, ...tail].map((g) => parseInt(g, 16));
  if (groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  if (ipv4Tail) groups = [...groups, ...ipv4Tail];
  if (halves.length === 2) {
    const missing = 8 - groups.length;
    if (missing < 0) return null;
    const insertAt = head.length;
    groups = [...groups.slice(0, insertAt), ...Array(missing).fill(0), ...groups.slice(insertAt)];
  }
  return groups.length === 8 ? groups : null;
}

/** True for IPv6 addresses that must not be reached by an outbound fetch. */
export function isPrivateIpv6(ip: string): boolean {
  const groups = parseIpv6(ip);
  if (!groups) return true;
  // IPv4-mapped (::ffff:a.b.c.d) -> classify the embedded IPv4.
  if (
    groups.slice(0, 5).every((g) => g === 0) &&
    groups[5] === 0xffff
  ) {
    const v4 = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isPrivateIpv4(v4);
  }
  const first = groups[0];
  if (groups.every((g) => g === 0)) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (first === 0x2001 && groups[1] === 0x0db8) return true; // 2001:db8::/32 docs
  if (first === 0x0064 && groups[1] === 0xff9b) return true; // 64:ff9b::/96 NAT64
  return false;
}

/** True when the given IP literal is not a public address. */
export function isPrivateIp(ip: string): boolean {
  return ip.includes(":") ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

/** True when a hostname is an obvious internal name. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return false;
}

/**
 * Synchronous URL validation: parse, require https, reject credentials and
 * internal hostnames, and reject literal private IPs. Throws on any violation.
 */
export function validateImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("invalid_url");
  }
  if (url.protocol !== "https:") throw new Error("insecure_url");
  if (url.username || url.password) throw new Error("invalid_url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(host)) throw new Error("blocked_host");
  const literalIsIp =
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  if (literalIsIp && isPrivateIp(host)) throw new Error("blocked_ip");
  return url;
}

/**
 * Resolve the hostname and reject when any resolved address is non-public.
 * A literal-IP URL is validated without DNS.
 */
export async function assertUrlSafeForDownload(raw: string): Promise<URL> {
  return (await resolveSafeUrl(raw)).url;
}

export interface SafeAddress {
  address: string;
  family: number;
}

export interface SafeUrl {
  url: URL;
  /** Validated public addresses; empty for a literal-IP URL. */
  addresses: SafeAddress[];
}

/**
 * Validate `raw` and return the URL together with its resolved public
 * addresses, so callers can PIN the connection to exactly these addresses
 * (closing the DNS-rebinding TOCTOU gap between validation and fetch).
 * A literal-IP URL yields an empty `addresses` list (no DNS needed).
 */
export async function resolveSafeUrl(raw: string): Promise<SafeUrl> {
  const url = validateImageUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literalIsIp =
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  if (literalIsIp) {
    if (isPrivateIp(host)) throw new Error("blocked_ip");
    return { url, addresses: [] };
  }
  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new Error("dns_failed");
  }
  if (records.length === 0) throw new Error("dns_failed");
  for (const record of records) {
    if (isPrivateIp(record.address)) throw new Error("blocked_ip");
  }
  return {
    url,
    addresses: records.map((r) => ({ address: r.address, family: r.family })),
  };
}