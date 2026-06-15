# AgentScope Operations Runbook

This runbook covers the most common operational scenarios for the
AgentScope control plane.

## Endpoints

| Service | URL | Purpose |
| --- | --- | --- |
| Next.js app | `http://localhost:3000` | Web UI + tRPC API |
| Next.js metrics | `http://localhost:3000/api/metrics` | Prometheus metrics (restrict in prod) |
| Next.js SSE stream | `http://localhost:3000/api/streams/<organizationId>` | Real-time event stream |
| Worker metrics | `http://localhost:9090/metrics` | Worker Prometheus metrics |
| Worker health | `http://localhost:9090/healthz` | Worker liveness probe |
| Splunk HEC | `http://localhost:8088` | HEC ingestion (events) |
| Splunk Web | `http://localhost:8000` | Splunk admin UI |
| Splunk mgmt API | `https://localhost:8089` | Search jobs, MCP server target |
| PostgreSQL | `postgresql://localhost:5432` | Primary data store |

## Logging

All services emit JSON-formatted structured logs via pino.

- Development: log level defaults to `debug`
- Production: log level defaults to `info`
- Override with `LOG_LEVEL=debug` env var

Each log line includes:

- `service` (e.g. `agentscope-workers`, `agentscope`)
- `component` (e.g. `agents.run-queue`, `telemetry.splunk`)
- `level`, `time`, `msg`
- Bound context: `requestId`, `userId`, `organizationId`, `path`

Sensitive fields are redacted automatically:

- `password`, `token`, `apiKey`, `authorization`
- HTTP `authorization` and `cookie` headers

## Metrics

Domain metrics:

| Metric | Type | Labels |
| --- | --- | --- |
| `agent_runs_total` | counter | `status` |
| `agent_run_duration_seconds` | histogram | `status` |
| `outbox_events_pending` | gauge | — |
| `outbox_events_delivered_total` | counter | `destination`, `status` |
| `splunk_hec_send_duration_seconds` | histogram | `status` |
| `splunk_mcp_search_duration_seconds` | histogram | `status`, `attempts` |
| `rate_limit_rejections_total` | counter | `route` |
| `tRPC_request_duration_seconds` | histogram | `path`, `ok` |
| `scheduled_run_triggers_total` | counter | `frequency` |
| `cost_budget_blocked_total` | counter | `period` |
| `sse_connections` | gauge | — |

> Per-tenant breakdowns (by `agent_id`, `organization_id`, `schedule_id`,
> etc.) are deliberately NOT exposed as metric labels to avoid Prometheus
> cardinality explosion in a multi-tenant deployment (one time series per
> tenant would OOM the scraper). Derive per-tenant views from logs or
> from the Splunk side — the `agentscope:event` sourcetype has the same
> fields with proper indexing, and the agent/session/run detail views
> in the dashboard pull from Postgres for per-tenant lookups.

Default Node.js process metrics are also exported (CPU, memory, GC, event loop lag).

## Common scenarios

### Splunk HEC down

**Symptom:** `outbox_events_delivered_total{status="error"}` increasing,
`outbox_events_pending` growing without bound.

**Check:**

1. `curl http://localhost:8088/services/collector/health`
2. `docker compose ps splunk` — confirm Splunk container is healthy.
3. Look for `splunk_hec_send_duration_seconds{status="error"}` in metrics.

**Fix:**

1. Restart Splunk: `docker compose restart splunk`.
2. Re-run `./scripts/splunk-setup.sh` to confirm HEC token.
3. Backlog drains automatically once Splunk is back.

### Splunk MCP server crashed

**Symptom:** `agent_run.completed` events missing `investigation` payloads.
MCP health check in the UI shows `ok: false`.

**Check:**

1. Confirm MCP binary: `which splunk-mcp-server` (must be on `PATH`).
2. Run a one-shot test: `SPLUNK_MCP_ENABLED=true splunk-mcp-server --help`.
3. Check worker logs for `mcp init failed` or `mcp search failed`.

**Fix:**

1. Re-run `./scripts/splunk-mcp-setup.sh` to reinstall the MCP server.
2. Verify `SPLUNK_MCP_COMMAND`, `SPLUNK_URL`, and auth env vars in `.env`.
3. Restart the worker; the MCP client reconnects on next call.

### Outbox backlog growing

**Symptom:** `outbox_events_pending > 1000`, `telemetry_event` events
absent from Splunk search.

**Check:**

1. `pnpm db:studio` — open the `telemetry_outbox` table.
2. Look at `status` and `lastError` columns.
3. `RUNS` per minute vs `delivered` per minute in the metrics panel.

**Fix:**

1. If `status = DeadLettered` rows are accumulating, look at
   `lastError` for the failure class.
2. If `status = Failed` rows are retrying, the worker will back off
   exponentially (5s, 10s, 20s, ..., capped at 10 minutes).
3. To force a redrain: `pnpm --filter @agentscope/workers dev` (worker picks
   up pending rows on next poll).

### Worker reaper stuck

**Symptom:** `agent_runs` stuck in `Running` longer than 10 minutes.

**Check:**

1. `agent_run.lockedAt` is older than 10 minutes for affected runs.
2. Worker logs for `reaped stale agent runs`.

**Fix:**

1. The stale-lock reaper runs every `AGENTSCOPE_AGENT_RUN_REAP_MS`
   (default 60s) and transitions stale runs to `Retrying` or
   `DeadLettered` depending on `maxAttempts`.
2. If the reaper is missing from logs, restart the worker.

### Rate-limit storm

**Symptom:** `rate_limit_rejections_total` increasing; users report
HTTP 429.

**Check:**

1. `tRPC_request_duration_seconds` to spot slow procedures.
2. `telemetry_outbox` for Splunk-related latency that may cascade.

**Fix:**

1. The default per-org limit is `defaultRateLimitPerMinute` (default
   120/min). Update via the Security policy router (Admin only).
2. Suspend a misbehaving integration: revoke its API key in the
   Settings page.

### Cost budget exceeded

**Symptom:** `cost_budget_blocked_total` increasing; an agent stops
producing runs.

**Check:**

1. UI: Agents → select agent → Budgets tab.
2. Look at the `usage` table for the period with the highest `used / max`.

**Fix:**

1. If a runaway agent caused it, cancel the offending run and pause
   the agent (`status = "Paused"`).
2. Increase the budget (Admin only) or wait for the window to reset.

### Splunk audit chain mismatch

**Symptom:** `verifyAuditChain` endpoint returns `mismatch: true` for
any organization.

**Check:**

1. UI: Compliance → Audit Log → "Verify chain".
2. Worker logs for `audit log verification failed`.

**Fix:**

1. This is a tamper alert. Investigate DB access logs for that org.
2. If the mismatch is a known false positive (e.g. backfill), document
   the cause and add a new compliance note.

## Health checks

The Next.js app exposes `GET /api/metrics` for Prometheus.
The worker exposes `GET /healthz` for liveness probes and
`GET /metrics` for Prometheus.

For Kubernetes:

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 9090
  initialDelaySeconds: 5
  periodSeconds: 10
```

## Backup & restore

- PostgreSQL: nightly `pg_dump` to S3 (configure separately).
- Splunk: index buckets — Splunk handles its own retention; back up
  `SPLUNK_HOME/var/lib/splunk` for cold storage.

## Escalation

- Database issues: check `pnpm db:studio`, then `docker compose logs postgres`.
- Splunk issues: see `scripts/splunk-setup.sh` and the Splunk docs at
  <https://docs.splunk.com>.
- Worker issues: check `docker compose logs worker` or `pnpm dev:worker`.
