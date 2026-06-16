import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

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
    assert.equal(
      invalidAfter,
      invalidBefore + 1,
      `expected stripe_webhook_events_total{status="invalid"} to tick by 1, got before=${invalidBefore} after=${invalidAfter}`,
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
    assert.equal(
      expiredAfter,
      expiredBefore + 1,
      `expected stripe_webhook_events_total{status="expired"} to tick by 1, got before=${expiredBefore} after=${expiredAfter}`,
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
