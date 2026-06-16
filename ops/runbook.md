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
| `mcp_watchdog_kills_total` | counter | — |
| `mcp_reconnects_total` | counter | — |
| `mcp_init_failures_total` | counter | `status` (`error`, `suppressed`) |
| `stripe_webhook_events_total` | counter | `status` (`accepted`, `dedup`, `invalid`, `expired`, `error`) |
| `http_fetch_timeouts_total` | counter | — |
| `db_pool_errors_total` | counter | — |

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
4. Check `mcp_init_failures_total{status="error"}` and
   `mcp_init_failures_total{status="suppressed"}` — a sustained
   `error` rate means the spawn is failing; a `suppressed` rate means
   the backoff is keeping the spawn rate bounded (expected during a
   long outage).

**Fix:**

1. Re-run `./scripts/splunk-mcp-setup.sh` to reinstall the MCP server.
2. Verify `SPLUNK_MCP_COMMAND`, `SPLUNK_URL`, and auth env vars in `.env`.
3. Restart the worker; the MCP client reconnects on next call.
4. After the next successful `tools/list`, `mcp_reconnects_total` should
   tick up exactly once. If it doesn't, the client never left the
   failure streak.

### MCP child process wedged (watchdog kill)

**Symptom:** `mcp_watchdog_kills_total` increasing.
`mcp.heartbeatHistory` on the dashboard shows the last sample with
`error: "mcp server idle for 60000ms; killed"`.

**Check:**

1. `getMcpStatus()` from the worker `/healthz` endpoint — the
   `heartbeatHistory` ring buffer shows whether kills are clustered
   (Splunk indexer unreachable) or isolated (a single bad request).
2. Splunk side: is the management API returning 5xx? The MCP server
   wedges most often when Splunk accepts the TCP connection but never
   replies to a search.

**Fix:**

1. The watchdog is the protection, not the bug. After a kill the next
   heartbeat (≤ 30s) spawns a fresh `splunk-mcp-server` child.
2. If kills cluster around a specific time window, check Splunk's
   indexer health at that window: `index=_internal source=*splunkd*`
   for errors.
3. To temporarily silence the watchdog while debugging, set
   `SPLUNK_MCP_ENABLED=false` in `.env` and restart the worker. The
   investigator will fall back to the direct search path
   (slower, but functional).

### Outbox backlog growing

**Symptom:** `outbox_events_pending > 1000`, `telemetry_event` events
absent from Splunk search.

**Check:**

1. `pnpm db:studio` — open the `telemetry_outbox` table.
2. Look at `status` and `lastError` columns.
3. `RUNS` per minute vs `delivered` per minute in the metrics panel.
4. `db_pool_errors_total` — a non-zero rate here means the pool is
   dropping idle clients, usually because Postgres was bounced or
   `max_connections` was hit. The pool self-heals (the bad client is
   removed and a fresh one is opened on the next query), but a
   sustained rate means the upstream is unhealthy.

**Fix:**

1. If `status = DeadLettered` rows are accumulating, look at
   `lastError` for the failure class.
2. If `status = Failed` rows are retrying, the worker will back off
   exponentially (5s, 10s, 20s, ..., capped at 10 minutes).
3. To force a redrain: `pnpm --filter @agentscope/workers dev` (worker picks
   up pending rows on next poll).
4. If `db_pool_errors_total` is climbing, check
   `select count(*) from pg_stat_activity` — if it is near
   `max_connections`, raise `AGENTSCOPE_DB_POOL_MAX` (or shrink the
   worker fleet).

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

### Stripe webhook replay storm

**Symptom:** `stripe_webhook_events_total{status="dedup"}` rate
climbing; `status="accepted"` rate stays flat. Stripe Dashboard shows
retries in flight.

**Check:**

1. The `processed_webhook_event` table is the source of truth — every
   row is one event id we have already handled. A growing table under
   sustained `dedup` pressure means Stripe is re-sending the same
   event id because our 2xx acknowledgement was lost in transit.
2. The Next.js API logs for `Stripe signature verification failed`
   alongside `stripe_webhook_events_total{status="invalid"}` — a
   rising `invalid` rate means the signing secret was rotated without
   updating `STRIPE_WEBHOOK_SECRET` in our env.

**Fix:**

1. The dedup is the protection, not the bug. `dedup` events return 2xx
   to Stripe so the retries will stop on their own.
2. If `status="invalid"` is climbing, rotate `STRIPE_WEBHOOK_SECRET` to
   match the new value in the Stripe Dashboard (or the previous
   one if rotating back). Stripe's SDK supports two secrets in
   parallel during rotation — set both and the verifier will accept
   either.
3. If `status="expired"` is climbing, our clock is drifting from
   Stripe's. Confirm NTP is configured on the API host
   (`chronyc tracking` or `ntpq -p`).

### HTTP tool timeouts

**Symptom:** `http_fetch_timeouts_total` rate climbing. Eval runs
report `HTTP tool timed out after 30000ms: <url>` in the tool
result envelope.

**Check:**

1. The URL in the timeout message is the offender — `pnpm --filter
   @agentscope/api exec node -e "fetch('<url>')"` to confirm the
   upstream is slow.
2. Per-tool timeout overrides: a Custom tool can set
   `config.timeoutMs` in its definition (1s..10m clamp). The
   counter ticks at the same rate regardless of the override.

**Fix:**

1. For a one-off slow upstream, raise `config.timeoutMs` on the
   specific tool definition (Admin → Tools).
2. For a platform-wide issue (e.g. a network partition), the
   30s default bounds the blast radius per tool call; a stuck
   agent run will still hit the cost budget after a few
   iterations.
3. The counter is informational — no action required for a
   small rate. Alert on `rate(http_fetch_timeouts_total[15m])
   > 10` for sustained trouble.

### Worker graceful shutdown

**Symptom:** Pods stuck in `Terminating` longer than
`terminationGracePeriodSeconds` (default 30s); Kubernetes sends
SIGKILL and the worker exits with no graceful drain.

**Check:**

1. Worker logs for `shutdown timed out; forcing exit` — this is the
   hard ceiling firing at `AGENTSCOPE_SHUTDOWN_TIMEOUT_MS` (default
   25s). The cap is intentionally a few seconds shorter than the
   Kubernetes grace period so we close the DB pool and disconnect
   the MCP child before SIGKILL.
2. `currentRunPromise` may be stuck on an LLM provider that is
   itself hung. Check the LLM provider's status page.

**Fix:**

1. The hard cap is the protection, not the bug. After SIGKILL the
   stale `AgentRun` row will be reaped by
   `reapStaleAgentRuns` on the next worker pod.
2. To raise the cap (e.g. for an LLM provider known to be slow),
   set `AGENTSCOPE_SHUTDOWN_TIMEOUT_MS=55000` and
   `terminationGracePeriodSeconds: 60` on the worker Deployment.
3. The metrics server is closed at the start of shutdown, so
   Kubernetes will see the worker as unhealthy immediately and stop
   routing new work to it.

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
