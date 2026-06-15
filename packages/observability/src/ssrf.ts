/**
 * SSRF protection for outbound HTTP webhooks and other untrusted URLs.
 *
 * AgentScope lets an organization admin configure webhook targets for
 * alert policies, and any code that fetches a user-supplied URL
 * (compliance exports, alerts, webhooks, ...) needs to validate it
 * before resolving. Without validation, a malicious or careless admin
 * could point a fetch at:
 *   - http://169.254.169.254/latest/meta-data/...  (cloud metadata)
 *   - http://localhost:6379/  (internal Redis)
 *   - http://10.0.0.5/admin  (internal HTTP service)
 *   - file:///etc/passwd     (non-http(s) scheme)
 *   - http://[::ffff:7f00:1]/  (hex-form IPv4-mapped IPv6 -> 127.0.0.1)
 *   - http://[::10.0.0.1]/     (deprecated IPv4-compatible IPv6)
 *
 * This module is the single source of truth for "is this URL safe to
 * fetch from the AgentScope worker?". The tRPC router validates on
 * policy creation/update; `sendWebhook` in `packages/agents/src/alerts.ts`
 * re-validates as defense in depth in case a future code path bypasses
 * the router.
 *
 * Implementation note: we delegate IP range checks to `net.BlockList`
 * (Node 15+). BlockList has well-tested parsers for both IPv4 and
 * IPv6 in standard form. For the IPv4-mapped (`::ffff:H.H.H.H`,
 * `::ffff:HHHH:HHHH`, `0:0:0:0:0:ffff:...`) and IPv4-compatible
 * (`::H.H.H.H`, deprecated RFC 4291 2006) variants, BlockList's
 * auto-unwrap is not always reliable (a hand-rolled split can produce
 * spurious hits on the reserved `240.0.0.0/4` range), so we extract
 * the embedded IPv4 ourselves with a regex and check it against the
 * IPv4 rules.
 *
 * NOTE: This is a string-based check on the hostname as written in the
 * URL. It does NOT perform DNS resolution, so a hostname that resolves
 * to a private IP (e.g. `evil.example.com` -> 10.0.0.5) would still
 * pass. For full SSRF protection, pair this with a DNS-resolution
 * check at the network layer (e.g. an egress proxy that pins resolved
 * IPs, or a `dns.lookup` + IP allowlist at fetch time).
 */

import { BlockList, isIPv4, isIPv6 } from "node:net";

const LOOPBACK_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
]);

/**
 * IP ranges that outbound webhooks must not target. The list is
 * intentionally conservative: any address that could be reachable
 * only from the local network or that has special semantics
 * (loopback, link-local, multicast, ...) is blocked. The IPv6 rules
 * cover the full `fe80::/10` link-local range, the full `fc00::/7`
 * unique-local range, the `64:ff9b::/96` NAT64 well-known prefix,
 * the `2001:db8::/32` documentation prefix, and `ff00::/8` multicast.
 * IPv4-mapped IPv6 is handled explicitly by `extractEmbeddedIpv4`
 * (BlockList's auto-unwrap is unreliable for hex-form and
 * full-form inputs).
 */
const blockedRanges = new BlockList();

// IPv4
blockedRanges.addSubnet("0.0.0.0", 8, "ipv4"); // "this network" + reserved
blockedRanges.addSubnet("10.0.0.0", 8, "ipv4"); // RFC 1918 private
blockedRanges.addSubnet("100.64.0.0", 10, "ipv4"); // CGN
blockedRanges.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
blockedRanges.addSubnet("169.254.0.0", 16, "ipv4"); // link-local (incl. cloud metadata)
blockedRanges.addSubnet("172.16.0.0", 12, "ipv4"); // RFC 1918 private
blockedRanges.addSubnet("192.168.0.0", 16, "ipv4"); // RFC 1918 private
blockedRanges.addSubnet("224.0.0.0", 4, "ipv4"); // multicast (224.0.0.0/4)
blockedRanges.addSubnet("240.0.0.0", 4, "ipv4"); // reserved (240.0.0.0/4)

// IPv6
blockedRanges.addAddress("::1", "ipv6"); // loopback
blockedRanges.addAddress("::", "ipv6"); // unspecified
blockedRanges.addSubnet("fc00::", 7, "ipv6"); // unique local
blockedRanges.addSubnet("fe80::", 10, "ipv6"); // link-local (full /10)
blockedRanges.addSubnet("ff00::", 8, "ipv6"); // multicast
blockedRanges.addSubnet("64:ff9b::", 96, "ipv6"); // NAT64 well-known prefix
blockedRanges.addSubnet("2001:db8::", 32, "ipv6"); // documentation

/**
 * Returns true if the given hostname resolves to a loopback,
 * private, or link-local address that should not be reachable
 * from an outbound webhook.
 */
export function isBlockedHostname(hostname: string): boolean {
  // Lowercase, strip URL-style brackets, and strip any IPv6 zone ID
  // (e.g. `fe80::1%eth0`) so `isIPv6` accepts the result.
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "");

  if (LOOPBACK_HOSTNAMES.has(normalized)) return true;

  // Common local suffixes
  if (
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".localdomain")
  ) {
    return true;
  }

  if (isIPv4(normalized)) {
    return blockedRanges.check(normalized, "ipv4");
  }

  if (isIPv6(normalized)) {
    // IPv4-mapped (`::ffff:H.H.H.H`, `::ffff:HHHH:HHHH`, or the
    // full form `0:0:0:0:0:ffff:...`) and IPv4-compatible
    // (`::H.H.H.H`, deprecated since RFC 4291 2006) embed an
    // IPv4 in the last 32 bits. BlockList's auto-unwrap is
    // unreliable for these (a naive split of `::ffff:8.8.8.8`
    // produces segments [0,0,0,0,0,0,0xffff,136], which a
    // hand-rolled unpacker decodes to `255.255.0.136` and
    // then trips the `240.0.0.0/4` reserved range). We do the
    // unwrap ourselves with a regex so the check is unambiguous.
    const embeddedIpv4 = extractEmbeddedIpv4(normalized);
    if (embeddedIpv4) {
      return blockedRanges.check(embeddedIpv4, "ipv4");
    }
    return blockedRanges.check(normalized, "ipv6");
  }

  return false;
}

/**
 * Extract the embedded IPv4 from an IPv4-mapped or IPv4-compatible
 * IPv6 address string. Returns the dotted-quad IPv4 or null if the
 * address is not one of these forms.
 *
 * IPv4-mapped: `::ffff:H.H.H.H`, `::ffff:HHHH:HHHH`, or the full
 *              form `0:0:0:0:0:ffff:...`. The `ffff` marker in
 *              segment[5] is what distinguishes this from a
 *              regular IPv6 with two trailing hex segments.
 *
 * IPv4-compatible (deprecated): `::H.H.H.H` or the full form
 *              `0:0:0:0:0:0:...`. Distinguished from regular IPv6
 *              by having exactly 6 leading zero segments.
 */
function extractEmbeddedIpv4(address: string): string | null {
  // IPv4-mapped: the `ffff` marker is the tell. Accept both the
  // shorthand `::ffff:` and the full form `0:0:0:0:0:ffff:`.
  const mappedMatch = address.match(
    /^(?:::ffff:|0+:0+:0+:0+:0+:ffff:)(.+)$/i,
  );
  if (mappedMatch && mappedMatch[1] !== undefined) {
    return parseEmbeddedTail(mappedMatch[1]);
  }

  // IPv4-compatible: 6 leading zero segments. The shorthand `::`
  // expands to 6 zeros + whatever follows.
  const compatibleMatch = address.match(/^(?:::|0+:0+:0+:0+:0+:0+:)(.+)$/);
  if (compatibleMatch && compatibleMatch[1] !== undefined) {
    return parseEmbeddedTail(compatibleMatch[1]);
  }

  return null;
}

/**
 * Parse the tail of an IPv4-mapped or IPv4-compatible address.
 * Accepts either dotted-decimal (`a.b.c.d`) or two hex 16-bit
 * groups (`HHHH:HHHH`).
 */
function parseEmbeddedTail(tail: string): string | null {
  if (isIPv4(tail)) return tail;

  const hexMatch = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMatch && hexMatch[1] !== undefined && hexMatch[2] !== undefined) {
    const high = parseInt(hexMatch[1], 16);
    const low = parseInt(hexMatch[2], 16);
    if (
      Number.isInteger(high) &&
      Number.isInteger(low) &&
      high >= 0 &&
      high <= 0xffff &&
      low >= 0 &&
      low <= 0xffff
    ) {
      return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    }
  }

  return null;
}

/**
 * Validate a webhook target URL. Returns an error message if the URL
 * is not safe to fetch, or `null` if it passes all checks.
 *
 * In production (`NODE_ENV=production`), `https` is required. In
 * development, `http` is allowed so a local webhook receiver
 * (e.g. `http://localhost:8081/agent-alerts`) still works.
 */
export function validateWebhookTarget(
  target: string,
  options: { requireHttps?: boolean } = {},
): string | null {
  const requireHttps =
    options.requireHttps ?? process.env.NODE_ENV === "production";

  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return "Webhook target must be a valid URL.";
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return "Webhook target must use http(s).";
  }

  if (requireHttps && url.protocol !== "https:") {
    return "Webhook target must use https in production.";
  }

  if (!url.hostname) {
    return "Webhook target must include a hostname.";
  }

  if (isBlockedHostname(url.hostname)) {
    return "Webhook target points to a loopback, private, or link-local address.";
  }

  return null;
}
