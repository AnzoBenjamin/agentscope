import { initMetrics, registerAllMetrics } from "@agentscope/observability";
import { initOpenTelemetry } from "@agentscope/telemetry";

let initialized = false;

/**
 * Initialize request-scoped observability infrastructure. Idempotent.
 * Splunk MCP is initialized lazily by investigation code paths.
 */
export function initObservability(): void {
  if (initialized) return;
  initialized = true;

  initMetrics();
  registerAllMetrics();
  void initOpenTelemetry();
}
