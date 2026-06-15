/**
 * OpenTelemetry integration for AgentScope.
 *
 * Configures OpenTelemetry to trace AgentScope session and event operations.
 * Traces are exported via OTLP for ingestion by Splunk Observability or any
 * OTLP-compatible backend.
 *
 * Configuration:
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP collector endpoint
 * - OTEL_SERVICE_NAME: Service name for tracing (default: "agentscope")
 */

import { createLogger } from "@agentscope/observability";

const logger = createLogger("telemetry.otel");

const OTEL_ENDPOINT =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces";

let otelInitialized = false;

/**
 * Initialize OpenTelemetry for the AgentScope platform.
 * Dependencies are dynamically imported and only loaded when
 * OTEL_EXPORTER_OTLP_ENDPOINT is configured.
 */
export async function initOpenTelemetry(): Promise<void> {
  if (otelInitialized) return;
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    logger.debug("no OTEL endpoint configured - tracing disabled");
    return;
  }

  try {
    const [sdk, traceExporter] = await Promise.all([
      import("@opentelemetry/sdk-trace-node"),
      import("@opentelemetry/exporter-trace-otlp-http"),
    ]);

    const provider = new sdk.NodeTracerProvider();

    const exporter = new traceExporter.OTLPTraceExporter({
      url: OTEL_ENDPOINT,
    });

    provider.addSpanProcessor(new sdk.SimpleSpanProcessor(exporter));
    provider.register();

    otelInitialized = true;
    logger.info({ endpoint: OTEL_ENDPOINT }, "tracing enabled");
  } catch (error) {
    logger.warn({ err: error }, "failed to initialize otel");
  }
}

export function isOtelEnabled(): boolean {
  return otelInitialized;
}
