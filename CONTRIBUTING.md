# Contributing to AgentScope

Welcome! This document describes the development workflow, the locked-in namespace, and the guards that protect it.

## Quick Start

```bash
# 1. Install deps
pnpm install

# 2. Copy the env template and fill in the values
cp .env.example .env
# Edit .env — at minimum, set AUTH_SECRET, OPENAI_API_KEY,
# STRIPE_SECRET_KEY, RESEND_API_KEY, and the Splunk credentials.

# 3. Start Postgres + Splunk
docker compose up -d
./scripts/splunk-setup.sh        # wait for HEC token
./scripts/splunk-mcp-setup.sh    # install Splunk MCP server

# 4. Apply DB schema and seed
pnpm db:generate
pnpm db:migrate
pnpm --filter @agentscope/db seed

# 5. Run the app and worker in separate terminals
pnpm dev:next
pnpm dev:worker
```

Open <http://localhost:3000>.

## Repo Layout

```text
apps/nextjs             Next.js web app
apps/workers            Durable agent run worker
packages/agents         Agent runtime + Splunk investigator
packages/api            tRPC routers
packages/auth           Better Auth
packages/db             Drizzle schema + client + seed
packages/observability  Pino logger + Prometheus metrics
packages/telemetry      Event storage + Splunk HEC + Splunk MCP
packages/ui             Shared UI primitives
tooling/                Shared ESLint/Prettier/TypeScript configs
turbo/generators        `pnpm turbo gen` package scaffolder
scripts/                Dev-environment helpers (Splunk, env, namespace guard)
ops/                    Runbooks and operator-facing docs
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the runtime data flow.

## Development Commands

| Command                  | What it does                                                       |
| ------------------------ | ------------------------------------------------------------------ |
| `pnpm dev:next`          | Watch-mode for the Next.js app + its workspace dependencies        |
| `pnpm dev:worker`        | Watch-mode for the agent run worker                                |
| `pnpm build`             | Build every workspace (turbo)                                      |
| `pnpm lint` / `lint:fix` | ESLint over every workspace                                        |
| `pnpm format` / `format:fix` | Prettier over every workspace                                  |
| `pnpm typecheck`         | `tsc --noEmit` over every workspace, plus the generator project    |
| `pnpm test`              | Run every workspace's test suite, then the generator smoke test    |
| `pnpm test:generators`   | Run just the generator smoke test (fast)                           |
| `pnpm db:generate`       | Generate a new Drizzle migration from schema changes               |
| `pnpm db:migrate`        | Apply pending migrations                                           |
| `pnpm db:studio`         | Open Drizzle Studio against the configured Postgres                |
| `pnpm check:env`         | Run `scripts/check-env-placeholders.sh` (fail on unfilled env vars) |

All commands run through Turborepo, so cross-workspace dependencies are respected (e.g. `pnpm dev:next` rebuilds the packages it imports first).

## The `@agentscope/` Namespace Lockdown

AgentScope uses `@agentscope/*` for all workspace packages. The legacy `@acme/*` scope is permanently removed and protected by three layers:

1. **Static check** — `scripts/check-namespace.sh` greps the source tree for any reference to `@acme/` and fails if found. The script uses `find` + `xargs grep` so the directory exclusion is path-based (not basename-based), preventing accidental collisions if a future `packages/generators/` or `apps/generators/` is added.
2. **Pre-commit hook** — `.husky/pre-commit` runs the namespace guard and the generator smoke test on every commit. POSIX `set -e` ensures the first failure halts the hook. Skip with `git commit --no-verify` if you need to commit a WIP, but re-run both guards before pushing.
3. **CI** — The `validate` job in `.github/workflows/ci.yml` runs the namespace guard and the generator smoke test as explicit steps after the regular `pnpm test`.

### What `@acme/`-style references are intentional?

Only the test inputs in `turbo/generators/config.test.ts` (which verify `normalizePackageName` rejects the wrong scope) and the doc comments in `turbo/generators/config.ts` (which document that rejection). These are excluded from the namespace guard because they exercise the lockdown, not violate it.

### If your commit is blocked

```text
✖ Namespace guard: found references to the old @acme/ scope.

./path/to/file.ts:42: import { foo } from "@acme/bar";
```

Fix: rename the import to `@agentscope/bar` and the corresponding `package.json` `name` field to `@agentscope/bar`. If the reference is intentional (e.g. a migration note), add the path to the find `-prune` list in `scripts/check-namespace.sh` with a comment explaining why — but the smoke test in `turbo/generators/config.test.ts` is the authoritative guard for the generator tree, not the grep.

## Adding a New Workspace Package

AgentScope ships a Turborepo generator. Run it from the repo root:

```bash
pnpm turbo gen init
```

You'll be prompted for:

1. **Package name** — bare (`foo`) or scoped (`@agentscope/foo`). The generator strips the `@agentscope/` prefix if you provide it. A different scope (`@acme/`, `@example/`, etc.) is rejected.
2. **Dependencies** — space-separated npm package names; the generator fetches the latest version from the registry and pins it as `^<version>` in `package.json`.

The generator creates:

```text
packages/<name>/
  eslint.config.ts
  package.json         (with @agentscope/ scope, scripts, deps)
  src/index.ts
  tsconfig.json
```

Then it runs `pnpm i` and `pnpm prettier --write` on the new tree.

The generator is type-checked and tested by `pnpm typecheck:generators` and `pnpm test:generators`. The smoke test in `turbo/generators/config.test.ts` asserts the templates hardcode the `@agentscope/` scope and contain no `@acme/` reference in any case.

## Environment Setup

`.env.example` documents every variable. Required for local dev:

```bash
POSTGRES_URL              # database connection (used by db:generate/migrate/studio)
AUTH_SECRET               # openssl rand -hex 32
NEXT_PUBLIC_APP_URL       # used for invite links + CORS
OPENAI_API_KEY            # agent runtime
STRIPE_SECRET_KEY         # billing checkout + webhook signature verification
RESEND_API_KEY            # invite emails
RESEND_FROM               # from-address for invites
SPLUNK_HEC_TOKEN          # Splunk HEC token
SPLUNK_PASSWORD           # Splunk admin password
SPLUNK_MCP_ENABLED=true   # enable the MCP server
```

Optional: `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` (Discord OAuth).

`pnpm check:env` verifies no placeholder values leaked into your `.env`.

## CI

`.github/workflows/ci.yml` runs four jobs on every push/PR:

1. **env-check** — `scripts/check-env-placeholders.sh` to make sure no unfilled `${...}` placeholders leaked into `.env`
2. **Lint** — `pnpm lint`
3. **Format** — `pnpm format` (Prettier over every workspace)
4. **Validate** — `pnpm typecheck`, `pnpm test`, the generator smoke test (`pnpm test:generators`), the namespace guard (`scripts/check-namespace.sh`), `pnpm build`, and an observability smoke test that imports `@agentscope/observability`, registers the metrics, increments `agentRunsTotal`, and asserts `serializeMetrics()` output contains `agent_runs_total`

If a CI run fails on the namespace guard, see [The `@agentscope/` Namespace Lockdown](#the-agentscope-namespace-lockdown) above.

## Style and Conventions

- **TypeScript:** `strict` + `noUncheckedIndexedAccess` (inherited from `tooling/typescript/base.json`). Use `unknown` over `any`; narrow with type guards or zod schemas.
- **Imports:** workspace packages as `@agentscope/<name>`; npm packages by name; relative paths for siblings only.
- **Formatting:** Prettier (shared config in `tooling/prettier/`).
- **React:** Server Components by default; mark interactive components with `"use client"`.
- **tRPC:** routers in `packages/api/src/router/`. Use the `authedProcedure` / `adminProcedure` / `publicProcedure` from `packages/api/src/trpc.ts` depending on the access model.
- **Database:** Drizzle schema in `packages/db/src/schema.ts`; never write raw SQL in app code.
- **Telemetry:** emit events through `packages/telemetry` (they're forwarded to Splunk HEC and stored in Postgres for replay).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
