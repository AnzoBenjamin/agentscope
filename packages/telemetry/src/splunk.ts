/**
 * Splunk HTTP Event Collector (HEC) integration.
 *
 * Forwards AgentScope events to Splunk for indexing, search,
 * and AI-powered analytics.
 *
 * Configuration via environment variables:
 * - SPLUNK_HEC_URL: Splunk HEC endpoint (e.g. https://splunk:8088/services/collector/event).
 *   The default `splunk/splunk:latest` image creates the HEC input with SSL
 *   enabled and a self-signed certificate, so the URL must be HTTPS and the
 *   HEC client accepts that self-signed cert in dev (and only on the HEC
 *   call — every other outbound request still gets strict verification).
 *   In production, mount a real CA cert and drop the HEC_HTTPS_AGENT below.
 * - SPLUNK_HEC_TOKEN: HEC authentication token.
 */

import * as https from "node:https";
import * as http from "node:http";

import {
  createLogger,
  splunkHecSendDurationSeconds,
} from "@agentscope/observability";

const logger = createLogger("telemetry.splunk");

interface SplunkEvent {
  time: number;
  host: string;
  source: string;
  sourcetype: string;
  index: string;
  event: Record<string, unknown>;
}

const HEC_URL =
  process.env.SPLUNK_HEC_URL ??
  "https://localhost:8088/services/collector/event";
const HEC_TOKEN = process.env.SPLUNK_HEC_TOKEN ?? "";

/**
 * Targeted self-signed-cert bypass for HEC only.
 *
 * `splunk/splunk:latest` ships with a self-signed TLS cert on the HEC
 * listener. To keep local dev working without weakening verification on
 * every other outbound call (OpenAI, Anthropic, Stripe, Resend, ...),
 * we attach a dedicated `https.Agent` with `rejectUnauthorized: false`
 * that is used solely by HEC requests.
 *
 * The bypass is **disabled by default in production** and only enabled
 * in development (or when `SPLUNK_HEC_TLS_REJECT_UNAUTHORIZED=false` is
 * explicitly set). Production deployments should mount a real CA cert
 * and leave verification on; the previous behavior of unconditionally
 * bypassing TLS verification for any HTTPS HEC URL was a security gap
 * flagged in the June 2026 code review.
 */
const HEC_TLS_BYPASS_ENABLED =
  process.env.SPLUNK_HEC_TLS_REJECT_UNAUTHORIZED === "false" ||
  process.env.NODE_ENV !== "production";

const HEC_HTTPS_AGENT: https.Agent | undefined =
  HEC_URL.startsWith("https://") && HEC_TLS_BYPASS_ENABLED
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

interface HecRequestInit {
  method: "GET" | "POST";
  body?: string;
  timeoutMs: number;
}

interface HecResponse {
  status: number;
  body: string;
}

function hecRequest(url: string, init: HecRequestInit): Promise<HecResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(
        new Error(
          `Invalid SPLUNK_HEC_URL: ${url} (${err instanceof Error ? err.message : String(err)})`,
        ),
      );
      return;
    }

    const isHttps = parsed.protocol === "https:";
    const transport = isHttps ? https : http;
    const agent = isHttps ? HEC_HTTPS_AGENT : undefined;

    const req = transport.request(
      {
        method: init.method,
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? "443" : "80"),
        path: `${parsed.pathname}${parsed.search}`,
        agent,
        headers: {
          Authorization: `Splunk ${HEC_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: init.timeoutMs,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(
        new Error(
          `HEC ${init.method} ${url} timed out after ${init.timeoutMs}ms`,
        ),
      );
    });

    if (init.body) req.write(init.body);
    req.end();
  });
}

let hecEnabled = !!process.env.SPLUNK_HEC_TOKEN;

/** Programmatically enable/disable Splunk forwarding */
export function setSplunkEnabled(enabled: boolean): void {
  hecEnabled = enabled && !!HEC_TOKEN;
}

export function isSplunkEnabled(): boolean {
  return hecEnabled;
}

export async function checkSplunkHecHealth(): Promise<{
  configured: boolean;
  ok: boolean;
  status?: number;
  url: string;
  error?: string;
}> {
  if (!HEC_TOKEN) {
    return {
      configured: false,
      ok: false,
      url: HEC_URL,
      error: "SPLUNK_HEC_TOKEN is not configured.",
    };
  }

  const healthUrl = HEC_URL.replace(
    /\/services\/collector\/event\/?$/,
    "/services/collector/health",
  );

  try {
    const response = await hecRequest(healthUrl, {
      method: "GET",
      timeoutMs: 5000,
    });

    const ok = response.status >= 200 && response.status < 300;
    return {
      configured: true,
      ok,
      status: response.status,
      url: healthUrl,
      error: ok ? undefined : response.body,
    };
  } catch (error) {
    logger.warn(
      { err: error, url: healthUrl },
      "splunk hec health check failed",
    );
    return {
      configured: true,
      ok: false,
      url: healthUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Forward an event to Splunk HEC.
 * No-ops when HEC is not configured. Fails loudly when HEC is configured
 * but Splunk cannot accept the event.
 */
export async function forwardToSplunk(event: {
  sessionId: string;
  eventType: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!hecEnabled) return;

  const splunkEvent: SplunkEvent = {
    time: Date.now() / 1000,
    host: "agentscope",
    source: "agentscope://telemetry",
    sourcetype: "agentscope:event",
    index: "main",
    event: {
      sessionId: event.sessionId,
      eventType: event.eventType,
      timestamp: new Date().toISOString(),
      ...event.payload,
      // `sessionId` and `eventType` are already at the top level of
      // the JSON event payload. INDEXED_EXTRACTIONS=json extracts them
      // as searchable fields. We deliberately do NOT also emit
      // `_splunk_session_id` / `_splunk_event_type` here: Splunk
      // reserves fields starting with `_` for internal metadata
      // (`_time`, `_raw`, `_indextime`) and silently drops custom
      // underscore-prefixed fields from indexed extraction, so the
      // duplicates would be dead weight and would mislead consumers
      // into writing queries that return zero rows.
    },
  };

  const start = Date.now();
  try {
    const response = await hecRequest(HEC_URL, {
      method: "POST",
      body: JSON.stringify(splunkEvent),
      timeoutMs: 5000,
    });

    if (response.status < 200 || response.status >= 300) {
      splunkHecSendDurationSeconds.observe(
        { status: "error" },
        (Date.now() - start) / 1000,
      );
      throw new Error(
        `Splunk HEC rejected ${event.eventType} for session ${event.sessionId}: ${response.status} ${response.body}`,
      );
    }
    splunkHecSendDurationSeconds.observe(
      { status: "ok" },
      (Date.now() - start) / 1000,
    );
  } catch (error) {
    splunkHecSendDurationSeconds.observe(
      { status: "error" },
      (Date.now() - start) / 1000,
    );
    throw error;
  }
}
