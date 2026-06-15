import { NextResponse } from "next/server";
import { initMetrics, registerAllMetrics, serializeMetrics } from "@agentscope/observability";

let initialized = false;
function ensureInit() {
  if (initialized) return;
  initialized = true;
  initMetrics();
  registerAllMetrics();
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Prometheus metrics endpoint. Should be scraped by an internal cluster
 * metrics collector. In production, restrict to internal IPs / VPC.
 */
export async function GET() {
  ensureInit();
  try {
    const body = await serializeMetrics();
    return new NextResponse(body, {
      status: 200,
      headers: { "Content-Type": "text/plain; version=0.0.4" },
    });
  } catch (error) {
    return new NextResponse(
      `metrics error: ${error instanceof Error ? error.message : String(error)}`,
      { status: 500 },
    );
  }
}
