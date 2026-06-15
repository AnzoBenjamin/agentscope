# Deployment

AgentScope runs as two production services backed by Postgres and Splunk:

- `apps/nextjs`: user-facing web app and tRPC API
- `apps/workers`: durable agent-run worker, Splunk investigation runner, and operational alert evaluator

## Required Services

- PostgreSQL 17 or compatible
- Splunk Enterprise or Splunk Cloud with HEC enabled
- Splunk MCP Server reachable from the worker
- Resend for invite and email alert delivery
- Stripe for billing checkout and invoice webhooks
- OpenAI API key for the default investigation agents

## Build And Migrate

```bash
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm build
pnpm test
```

`pnpm db:generate` is for creating new reviewable SQL migrations during development. Production deploys should run `pnpm db:migrate`, not `db:push`.

## Docker Compose

For a single-host production-style deployment:

```bash
cp .env.example .env
docker compose -f docker-compose.prod.yml up --build
```

Set `POSTGRES_URL` in `.env` to the internal Postgres host:

```bash
POSTGRES_URL=postgresql://agentscope:${POSTGRES_PASSWORD}@postgres:5432/agentscope
```

The `migrate` service applies Drizzle migrations before the web and worker services start.

## Runtime Checks

After deployment:

1. Open `/dashboard` and verify Splunk HEC and MCP readiness.
2. Open `/settings` and confirm billing, compliance, alert policies, and member management load.
3. Queue an agent run from `/agents`.
4. Confirm the worker moves it through `Queued -> Running -> Completed` or a visible failed/retrying state.
5. Confirm the session replay includes model, tool, cost, Splunk MCP search, and investigation events.
