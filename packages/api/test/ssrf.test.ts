import assert from "node:assert/strict";
import test from "node:test";

import {
  isBlockedHostname,
  validateWebhookTarget,
} from "../../observability/src";

void test("isBlockedHostname rejects loopback hostnames", () => {
  for (const host of ["localhost", "127.0.0.1", "::1", "0.0.0.0"]) {
    assert.equal(
      isBlockedHostname(host),
      true,
      `expected ${host} to be blocked`,
    );
  }
});

void test("isBlockedHostname rejects private IPv4 ranges", () => {
  for (const host of [
    "10.0.0.5",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "169.254.169.254", // AWS metadata
    "100.64.0.1", // CGN
    "224.0.0.1", // multicast
    "240.0.0.1", // reserved
  ]) {
    assert.equal(
      isBlockedHostname(host),
      true,
      `expected ${host} to be blocked`,
    );
  }
});

void test("isBlockedHostname rejects private IPv6 ranges", () => {
  for (const host of [
    "::1",
    "::",
    "fe80::1", // link-local /10
    "fe90::1", // link-local outside fe80::/16
    "febf::1", // link-local outside fe80::/16
    "fc00::1", // unique local /7
    "fd00::1", // unique local /7
    "64:ff9b::a00:5", // NAT64 /96 (embeds 10.0.0.5)
    "ff02::1", // multicast /8
    "2001:db8::1", // documentation /32
  ]) {
    assert.equal(
      isBlockedHostname(host),
      true,
      `expected ${host} to be blocked`,
    );
  }
});

void test("isBlockedHostname rejects IPv4-mapped IPv6 in all forms", () => {
  // These are the bypasses the first round of the SSRF guard missed:
  // hex-form (`::ffff:HHHH:HHHH`) and the explicit full form
  // (`0:0:0:0:0:ffff:...`) both reach the embedded IPv4 check via
  // Node's BlockList.
  for (const host of [
    "::ffff:10.0.0.1", // dotted, RFC 1918
    "::ffff:7f00:1", // hex, 127.0.0.1
    "::ffff:c0a8:101", // hex, 192.168.1.1
    "0:0:0:0:0:ffff:10.0.0.1", // full form, RFC 1918
    "0:0:0:0:0:ffff:7f00:0001", // full form, hex
    "[::ffff:10.0.0.1]", // URL-style brackets
  ]) {
    assert.equal(
      isBlockedHostname(host),
      true,
      `expected ${host} to be blocked`,
    );
  }
});

void test("isBlockedHostname rejects common local suffixes", () => {
  for (const host of [
    "host.localhost",
    "printer.local",
    "service.internal",
    "host.localdomain",
  ]) {
    assert.equal(
      isBlockedHostname(host),
      true,
      `expected ${host} to be blocked`,
    );
  }
});

void test("isBlockedHostname allows public-looking hostnames", () => {
  for (const host of [
    "example.com",
    "hooks.slack.com",
    "api.openai.com",
    "splunk.example.org",
    "8.8.8.8", // public DNS
    "1.1.1.1",
    "::ffff:8.8.8.8", // IPv4-mapped public (BlockList should unwrap and pass)
  ]) {
    assert.equal(
      isBlockedHostname(host),
      false,
      `expected ${host} to be allowed`,
    );
  }
});

void test("validateWebhookTarget accepts a public https URL", () => {
  assert.equal(
    validateWebhookTarget("https://hooks.example.com/alerts", {
      requireHttps: true,
    }),
    null,
  );
});

void test("validateWebhookTarget rejects loopback in dev (http)", () => {
  // In development, http is allowed but loopback is still blocked --
  // an admin who can configure webhooks should not be able to point
  // them at the API's own internal services.
  assert.notEqual(
    validateWebhookTarget("http://localhost:8081/agent-alerts", {
      requireHttps: false,
    }),
    null,
  );
  assert.notEqual(
    validateWebhookTarget("http://127.0.0.1:6379", { requireHttps: false }),
    null,
  );
});

void test("validateWebhookTarget rejects AWS metadata endpoint", () => {
  assert.notEqual(
    validateWebhookTarget("http://169.254.169.254/latest/meta-data/", {
      requireHttps: false,
    }),
    null,
  );
});

void test("validateWebhookTarget rejects http in production", () => {
  assert.notEqual(
    validateWebhookTarget("http://hooks.example.com/alerts", {
      requireHttps: true,
    }),
    null,
  );
});

void test("validateWebhookTarget rejects non-http(s) schemes", () => {
  for (const target of [
    "file:///etc/passwd",
    "gopher://example.com/_",
    "ftp://example.com/",
    "javascript:alert(1)",
  ]) {
    assert.notEqual(
      validateWebhookTarget(target, { requireHttps: false }),
      null,
      `expected ${target} to be rejected`,
    );
  }
});

void test("validateWebhookTarget rejects malformed URLs", () => {
  for (const target of ["", "not-a-url", "http://", "://foo"]) {
    assert.notEqual(
      validateWebhookTarget(target, { requireHttps: false }),
      null,
      `expected "${target}" to be rejected`,
    );
  }
});
