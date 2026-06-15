# AgentScope

AgentScope is a Splunk-powered control plane, black box recorder, and incident investigator for AI agents.

It lets a team run AI employees, capture every step of their work, replay the session, attribute model cost, and investigate behavior through Splunk MCP. The product thesis is that AI agents need the same production-grade observability, auditability, and incident response workflows as services, jobs, and human-operated systems.

## Submission Blurb

A polished 280-word version of this pitch — formatted for the submission form's "text description" field — is in [`SUBMISSION_BLURB.md`](./SUBMISSION_BLURB.md).

AgentScope is the operations plane for AI employees: a control plane that queues agent work, a black box recorder that captures every model call and tool invocation, and an incident investigator that uses the **Splunk MCP Server** to search its own telemetry and produce a risk-graded operations report. The product is submitted to the **Observability** track and is built around a single bet — AI agents need the same audit, replay, and incident-response workflows that services, jobs, and human operators already have, and Splunk is the place to put that data.

**Splunk capabilities used at runtime**

- **Splunk MCP Server** (`packages/telemetry/src/mcp.ts` → `packages/agents/src/splunk-investigator.ts`): the investigator spawns the Splunk MCP Server over stdio and issues SPL searches against the active session's events to produce its operations report. This is not a UI call to Splunk — it is an agent calling Splunk via MCP to investigate another agent.
- **Splunk HTTP Event Collector (HEC)** (`packages/telemetry/src/splunk.ts`): every `ModelInvoked`, `ModelCompleted`, `ToolCalled`, `ToolReturned`, `CostRecorded`, and `SessionStarted/Completed` event is forwarded to HEC into the `agentscope:event` sourcetype. The MCP search above runs against the same data.
- **Splunk Management API / SPL** (`packages/telemetry/src/anomaly.ts`, `packages/api/src/router/splunk.ts`): the dashboard and operations page run direct SPL queries through the management API for cost-by-agent, p50/p95 model latency, and tool reliability.

The data flow is end-to-end: a queued run → worker → agent runtime → telemetry package → Postgres + Splunk HEC → Splunk MCP search → risk-graded investigation report → session replay in the web UI. A schema validator, retry queue, and per-session cost guardrail keep the pipeline production-shaped. The full architecture is in [ARCHITECTURE.md](./ARCHITECTURE.md) and [`architecture_diagram.mmd`](./architecture_diagram.mmd) (with a rendered [`architecture_diagram.png`](./architecture_diagram.png)).

## Submission Track

Primary track: **Observability**

Prize fit:

- **Best of Observability** — agent observability built on Splunk as the source of truth, not a sidecar.
- **Best Use of Splunk MCP Server** — the investigator calls the Splunk MCP Server to query the same telemetry it just emitted, closing the loop inside Splunk.

## What The Product Shows

1. A signed-in user opens the Agents page.
2. New users create an organization; AgentScope creates an owner membership and starter AI employees.
3. The user queues an AI employee investigation task.
4. AgentScope writes an `agent_run` job record with status, retry, lock, requester, and result fields.
5. The worker claims the run, creates an `agent_session`, and executes the agent.
6. The agent emits replayable events such as `SessionStarted`, `ToolCalled`, `ModelInvoked`, `ModelCompleted`, `CostRecorded`, and `SessionCompleted`.
7. The telemetry package stores every event in Postgres and forwards it to Splunk HEC.
8. The investigator calls Splunk MCP at runtime to search the session's Splunk events.
9. The app shows queued/retrying/completed run state, a Splunk MCP investigation summary, risk level, SPL query, and findings.
10. The Sessions page can replay the event timeline for audit and debugging.

## Screenshots

Executive dashboard with Splunk readiness, agent scorecards, cost trends, and the live event stream:

![AgentScope dashboard — Splunk readiness, agent scorecards, charts, live event stream](docs/screenshots/screenshot-dashboard.png)

Agents page with the Splunk Investigation form, run status, and rendered investigation report (click **Show SPL query** to reveal the code block the investigator used):

![Agents page — Run Splunk Investigation, run status cards, investigation report with FINDINGS and SPL code block](docs/screenshots/screenshot-agents-list.png)

The investigation report's SPL code block (what the Splunk AI Investigator executed via the Splunk MCP Server):

![Investigation report — rendered markdown, risk level, FINDINGS bullets, revealed SPL code block with copy button](docs/screenshots/screenshot-agents-expanded.png)

Session replay with the full 13-event timeline — SessionStarted, ToolCalled, ModelInvoked, ModelCompleted, CostRecorded, SessionCompleted, SplunkMcpSearch, and SplunkInvestigationCompleted — with SVG icons and time deltas:

![Session replay — 13 events captured, SVG icons per event type, time deltas, model tokens/cost chip strip, Splunk MCP search event](docs/screenshots/screenshot-session-replay.png)

## Splunk AI Runtime Use

AgentScope does not only describe a Splunk integration. It calls Splunk capabilities while the app runs:

- `packages/telemetry/src/splunk.ts` forwards AgentScope events to Splunk HEC.
- `packages/telemetry/src/mcp.ts` connects to the Splunk MCP Server over stdio.
- `packages/agents/src/splunk-investigator.ts` runs a Splunk MCP search for the active session and produces an AI operations investigation result.
- `packages/agents/src/run-queue.ts` executes queued agent runs and retries transient failures.
- `packages/api/src/router/agent.ts` exposes `agent.enqueueRun`, `agent.run`, run history, and cancellation.
- `apps/nextjs/src/app/agents/_components/agents-content.tsx` provides the UI that queues runs and polls real run status.

The main runtime query shape (a session-scoped search the investigator
runs through the Splunk MCP Server) is:

```spl
search index=main sourcetype=agentscope:event sessionId="<sessionId>"
| sort _time
| table _time eventType agentName provider model modelName toolName cost tokensIn tokensOut duration error
```

The actual investigator query scopes on `_raw="*<sessionId>*"` to also
exclude the investigator's own meta-events from its result set — see
`packages/agents/src/splunk-investigator.ts:44`.

## Architecture

The required architecture diagram is in [ARCHITECTURE.md](./ARCHITECTURE.md).

High-level flow:

```text
Next.js UI
  -> tRPC API
  -> Postgres agent_run queue
  -> AgentScope worker
  -> Agent Runtime
  -> Telemetry Package
  -> Postgres + Splunk HEC
  -> Splunk MCP Server
  -> Splunk-backed investigation result
  -> Session replay and dashboard
```

## Monorepo Layout

```text
apps/nextjs             Main web app
apps/workers            Durable agent run worker
packages/api            tRPC API and protected routers
packages/agents         Agent runtime and Splunk investigator
packages/telemetry      Postgres event storage, Splunk HEC, Splunk MCP, anomaly checks
packages/db             Drizzle schema, migrations, database client, seed data
packages/auth           Better Auth configuration
packages/observability  Pino logger + Prometheus metrics
packages/ui             Shared UI primitives
```

## Requirements

- Node.js 22.21 or newer
- pnpm 10.19 or newer
- Docker
- A Splunk Enterprise local instance or compatible Splunk instance
- OpenAI API key for agent execution and investigation summaries
- Resend API key for organization invite emails
- Stripe keys for billing checkout and webhook ingestion

Agent execution and investigation are fail-closed: missing Splunk MCP or AI provider credentials cause an explicit failed run instead of returning synthetic analysis.

## Setup

Install dependencies:

```bash
pnpm install
```

Create an environment file:

```bash
cp .env.example .env
```

Set at least:

```bash
POSTGRES_URL=postgresql://agentscope:agentscope@localhost:5432/agentscope
AUTH_SECRET=<openssl-rand-hex-32>
OPENAI_API_KEY=<your-openai-key>
SPLUNK_HEC_TOKEN=<your-splunk-hec-token>
SPLUNK_PASSWORD=<your-splunk-admin-password>
SPLUNK_MCP_ENABLED=true
NEXT_PUBLIC_APP_URL=http://localhost:3000
RESEND_API_KEY=<your-resend-key>
RESEND_FROM="AgentScope <onboarding@your-domain.com>"
```

Start Postgres and Splunk:

```bash
docker compose up -d
```

Configure Splunk HEC:

```bash
./scripts/splunk-setup.sh
```

Configure Splunk MCP:

```bash
./scripts/splunk-mcp-setup.sh
```

Create and apply database migrations:

```bash
pnpm db:generate
pnpm db:migrate
```

Optional: seed historical demo agents, sessions, costs, and events:

```bash
pnpm --filter @agentscope/db seed
```

Run the app and worker in separate terminals:

```bash
pnpm dev:next
pnpm dev:worker
```

Open:

```text
http://localhost:3000
```

## Demo Script

The full 3-minute shot list (timestamps, on-screen action, voiceover, recording checklist) is in [`docs/DEMO_VIDEO_SCRIPT.md`](./docs/DEMO_VIDEO_SCRIPT.md).

1. Sign up with email and password.
2. Create an organization when prompted.
3. Open `/dashboard` and confirm Splunk Readiness shows HEC and MCP status.
4. Open `/agents`.
5. Queue a run from the Run Splunk Investigation panel.
6. Confirm the recent run moves from `Queued` to `Running` to `Completed` after the worker processes it.
7. Confirm the result shows:
   - Run status
   - Session replay link
   - Risk level
   - Token and cost totals
   - Investigation summary
   - SPL query
8. Click "Open replay".
9. Show the session timeline with model, tool, cost, Splunk search, and investigation events.
10. In Splunk, search for:

```spl
index=main sourcetype=agentscope:event
| sort -_time
| table _time sessionId eventType agentName provider modelName toolName cost
```

## Runtime Data Model

Core tables:

- `organization`
- `organization_member`
- `organization_invite`
- `agent`
- `agent_run`
- `agent_session`
- `event`
- `cost`

Core event types:

- `SessionStarted`
- `PromptReceived`
- `ContextLoaded`
- `ToolCalled`
- `ToolReturned`
- `ModelInvoked`
- `ModelCompleted`
- `CostRecorded`
- `SessionCompleted`
- `SessionFailed`
- `SplunkMcpSearch`
- `SplunkInvestigationCompleted`

## Current Product Scope

AgentScope now includes the production-oriented control surfaces needed to run the concept beyond a static hackathon demo:

- AgentScope domain schema
- reviewable Drizzle SQL migrations
- database-backed organization membership and RBAC
- Resend-backed organization invites
- organization profile management
- multi-organization switching
- AI agent runtime
- durable worker-executed agent run queue with row locking and retries
- event-sourced session replay
- Splunk HEC forwarding
- Splunk MCP client integration
- Splunk-backed investigation result
- Splunk readiness health checks
- billing plans, Stripe checkout, invoice webhook ingestion, and usage ledger
- compliance policy controls, audit logs, CSV/JSON exports
- email/webhook alert policies for failed runs, cost thresholds, queue backlog, and Splunk readiness
- Next.js dashboard, agents, sessions, and settings/admin views
- local Postgres and Splunk Docker setup
- seed data and demo workflow

## Validation

Useful checks:

```bash
pnpm --filter @agentscope/db build
pnpm --filter @agentscope/telemetry build
pnpm --filter @agentscope/agents build
pnpm --filter @agentscope/api build
pnpm --filter @agentscope/workers build
pnpm --filter @agentscope/nextjs typecheck
pnpm --filter @agentscope/nextjs build
```

## License

MIT. See [LICENSE](./LICENSE).
