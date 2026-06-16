import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import net from "node:net";
import test from "node:test";

/**
 * Probe a Postgres URL with a short TCP-connect timeout. Returns
 * `false` for any failure (refused, timeout, no POSTGRES_URL set, or
 * an unparseable URL) so callers can use it as a skip-guard. We
 * deliberately do NOT open a real query: the pg pool is expensive to
 * construct for a single test, and a TCP-level probe is enough to
 * distinguish "DB container is up" from "DB container is down" for
 * the purposes of this test.
 */
async function isPostgresReachable(url: string | undefined): Promise<boolean> {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname;
  const port = Number(parsed.port) || 5432;
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (ok: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 500);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

void test(
  "handleStripeWebhook increments stripe_webhook_events_total{status=\"invalid\"} on a bad signature",
  async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const payload = JSON.stringify({
      id: "evt_metric_invalid",
      type: "invoice.paid",
      data: { object: {} },
    });
    // Fresh timestamp so the rejection is the signature, not the
    // tolerance window — the counter distinguishes the two statuses.
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = `t=${timestamp},v1=deadbeef`;

    const { handleStripeWebhook } = await import(
      "../src/billing/stripe-webhook"
    );
    const { stripeWebhookEventsTotal } = await import(
      "@agentscope/observability"
    );
    // `Counter.get()` returns `{ name, help, type, values: [...] }`.
    // `values` is the array of label combinations; each entry is
    // `{ value, labels: { status } }`. The first test in this file
    // imported the wrong return shape and compiled fine because the
    // array `.find` produced `MetricObjectWithValues` (a single object)
    // from TypeScript's perspective — silently returning `undefined`
    // at runtime. We now access `.values` explicitly.
    const before = await stripeWebhookEventsTotal.get();
    const invalidBefore =
      before.values.find(
        (m) => m.labels.status === "invalid",
      )?.value ?? 0;

    await assert.rejects(
      () => handleStripeWebhook({ payload, signature }),
      /signature verification failed/,
    );

    const after = await stripeWebhookEventsTotal.get();
    const invalidAfter =
      after.values.find(
        (m) => m.labels.status === "invalid",
      )?.value ?? 0;
    // `>=` (not `===`) so a slow CI host where a sibling test in the
    // same process has already incremented the same label between the
    // two `get()` calls does not flake. The only invariant we care
    // about is that *this* invalid-signature call ticked the counter
    // by at least one.
    assert.ok(
      invalidAfter >= invalidBefore + 1,
      `expected stripe_webhook_events_total{status="invalid"} to tick by >= 1, got before=${invalidBefore} after=${invalidAfter}`,
    );
  },
);

void test(
  "handleStripeWebhook increments stripe_webhook_events_total{status=\"expired\"} on an out-of-tolerance timestamp",
  async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const payload = JSON.stringify({
      id: "evt_metric_expired",
      type: "invoice.paid",
      data: { object: {} },
    });
    // One hour ago, well outside the 5-minute tolerance. The HMAC is
    // valid for this timestamp — the rejection is the clock skew, not
    // the signature.
    const oldTimestamp = Math.floor(Date.now() / 1000) - 3600;
    const digest = createHmac("sha256", "whsec_test")
      .update(`${oldTimestamp}.${payload}`)
      .digest("hex");
    const signature = `t=${oldTimestamp},v1=${digest}`;

    const { handleStripeWebhook } = await import(
      "../src/billing/stripe-webhook"
    );
    const { stripeWebhookEventsTotal } = await import(
      "@agentscope/observability"
    );
    const before = await stripeWebhookEventsTotal.get();
    const expiredBefore =
      before.values.find(
        (m) => m.labels.status === "expired",
      )?.value ?? 0;

    await assert.rejects(
      () => handleStripeWebhook({ payload, signature }),
      /out of tolerance/,
    );

    const after = await stripeWebhookEventsTotal.get();
    const expiredAfter =
      after.values.find(
        (m) => m.labels.status === "expired",
      )?.value ?? 0;
    assert.ok(
      expiredAfter >= expiredBefore + 1,
      `expected stripe_webhook_events_total{status="expired"} to tick by >= 1, got before=${expiredBefore} after=${expiredAfter}`,
    );
  },
);

void test(
  "verifyStripeEvent rejects a signature whose timestamp is outside the tolerance window",
  async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const payload = JSON.stringify({
      id: "evt_old",
      type: "invoice.paid",
      data: { object: {} },
    });
    // One hour ago, well outside the 5-minute tolerance.
    const oldTimestamp = Math.floor(Date.now() / 1000) - 3600;
    const signedPayload = `${oldTimestamp}.${payload}`;
    const digest = createHmac("sha256", "whsec_test")
      .update(signedPayload)
      .digest("hex");
    const signature = `t=${oldTimestamp},v1=${digest}`;

    const { handleStripeWebhook } = await import("../src/billing/stripe-webhook");

    await assert.rejects(
      () => handleStripeWebhook({ payload, signature }),
      /out of tolerance/,
    );
  },
);

void test(
  "verifyStripeEvent rejects an invalid HMAC even when the timestamp is fresh",
  async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const payload = JSON.stringify({
      id: "evt_bad",
      type: "invoice.paid",
      data: { object: {} },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = `t=${timestamp},v1=deadbeef`;

    const { handleStripeWebhook } = await import("../src/billing/stripe-webhook");

    await assert.rejects(
      () => handleStripeWebhook({ payload, signature }),
      /signature verification failed/,
    );
  },
);

void test(
  "verifyStripeEvent rejects a missing or malformed signature header",
  async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const payload = JSON.stringify({
      id: "evt_missing",
      type: "invoice.paid",
      data: { object: {} },
    });

    const { handleStripeWebhook } = await import("../src/billing/stripe-webhook");

    await assert.rejects(
      () => handleStripeWebhook({ payload, signature: null }),
      /Invalid Stripe signature header/,
    );

    await assert.rejects(
      () => handleStripeWebhook({ payload, signature: "garbage" }),
      /Invalid Stripe signature header/,
    );
  },
);

void test(
  "handleStripeWebhook increments stripe_webhook_events_total{status=\"accepted\"} on a valid signature",
  // The "accepted" branch in handleStripeWebhook only fires after the
  // `processed_webhook_event` row is INSERTed, which requires a live
  // Postgres. We probe the DB at test start via a short TCP connect
  // (500ms) and `t.skip()` if it is not reachable. The probe (not just
  // the env-var presence check) is the right gate: the .env.example
  // default sets POSTGRES_URL to localhost:5432 even on a clean CI
  // checkout where no DB is running, and we want the test to skip in
  // that case too. Run `docker compose up -d` and the full suite
  // locally to exercise the happy path.
  async (t) => {
    if (!(await isPostgresReachable(process.env.POSTGRES_URL))) {
      t.skip("Postgres not reachable; skipping DB-dependent test");
      return;
    }
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const payload = JSON.stringify({
      id: "evt_metric_accepted",
      type: "invoice.paid",
      data: { object: {} },
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHmac("sha256", "whsec_test")
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    const signature = `t=${timestamp},v1=${digest}`;

    const { handleStripeWebhook } = await import(
      "../src/billing/stripe-webhook"
    );
    const { stripeWebhookEventsTotal } = await import(
      "@agentscope/observability"
    );
    const before = await stripeWebhookEventsTotal.get();
    const acceptedBefore =
      before.values.find((m) => m.labels.status === "accepted")?.value ?? 0;

    // First invocation in a fresh process is the cleanest signal for
    // the "accepted" status path. On a re-run, the previously-inserted
    // `processed_webhook_event` row will collide and tick the `dedup`
    // counter instead — `>=` accommodates that path.
    const event = (await handleStripeWebhook({ payload, signature })) as {
      id: string;
      type: string;
    };
    assert.equal(event.id, "evt_metric_accepted");
    assert.equal(event.type, "invoice.paid");

    const after = await stripeWebhookEventsTotal.get();
    const acceptedAfter =
      after.values.find((m) => m.labels.status === "accepted")?.value ?? 0;
    assert.ok(
      acceptedAfter >= acceptedBefore + 1,
      `expected stripe_webhook_events_total{status="accepted"} to tick by >= 1, got before=${acceptedBefore} after=${acceptedAfter}`,
    );
  },
);

void test(
  "verifyStripeEvent rejects a malformed signature header (no v1= field)",
  async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    const payload = JSON.stringify({
      id: "evt_no_v1",
      type: "invoice.paid",
      data: { object: {} },
    });
    // A `t=` timestamp but no `v1=` signature component. The parser
    // splits on commas and looks for both; missing the digest must
    // surface as "Invalid Stripe signature header.", NOT as a silent
    // false positive that would let a replay through.
    const signature = "t=1234567890";
    const { handleStripeWebhook } = await import(
      "../src/billing/stripe-webhook"
    );
    await assert.rejects(
      () => handleStripeWebhook({ payload, signature }),
      /Invalid Stripe signature header/,
    );
  },
);
