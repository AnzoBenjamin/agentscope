import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Import env files to validate at build time. Use jiti so we can load .ts files in here.
await jiti.import("./src/env");

/** @type {import("next").NextConfig} */
const config = {
  /**
   * Keep Turbopack rooted at this pnpm workspace. Without this, a parent
   * lockfile can make Next resolve server externals from the wrong directory.
   *
   * `resolveAlias` maps the dev-only transitive deps under
   * `thread-stream/test/*` (discovered by Turbopack's tree walk but never
   * imported at runtime) to an empty stub. This avoids the
   * "Module not found" failures for `tap`, `desm`, `fastbench`, etc.
   */
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      // Alias `thread-stream` itself so Turbopack doesn't descend into its
      // `test/` directory (which transitively `require()`s the dev-only deps
      // below). The stub is never executed at runtime because our logger
      // does not use `pino/transport`.
      "thread-stream": "./scripts/stubs/empty.ts",
      tap: "./scripts/stubs/empty.ts",
      desm: "./scripts/stubs/empty.ts",
      fastbench: "./scripts/stubs/empty.ts",
      "why-is-node-running": "./scripts/stubs/empty.ts",
      "pino-elasticsearch": "./scripts/stubs/empty.ts",
      "pino-pretty": "./scripts/stubs/empty.ts",
    },
  },

  /**
   * Tell Turbopack to leave these server packages as runtime `require()`s
   * instead of trying to bundle them statically.
   *
   * - `@sentry/node` and `@sentry/browser` are loaded dynamically by
   *   `packages/observability/src/sentry.ts` only when `SENTRY_DSN` is set.
   *   They are optional peer dependencies; bundling them statically fails
   *   when they aren't installed locally.
   * - `pino` transitively imports `thread-stream`'s dev-only test helpers
   *   (e.g. `tap`, `desm`, `fastbench`, `why-is-node-running`) which are
   *   not present in production. Externalizing `pino` (and the
   *   `pino/transport` subpath) lets Node resolve them at runtime instead
   *   of asking the bundler to.
   */
  serverExternalPackages: [
    "@sentry/node",
    "@sentry/browser",
    "pino",
    "pino/transport",
    "thread-stream",
    // Pino's transport layer transitively imports these dev-only helpers
    // from `thread-stream/test/*` (used by pino's own test suite). They're
    // never resolved at runtime. Externalizing them keeps the runtime
    // `require()` from failing; the `turbopack.resolveAlias` map above is
    // what actually short-circuits the static tree walk (without it,
    // Turbopack still descends into `thread-stream/test/helper.js` and
    // tries to bundle `why-is-node-running`, which isn't installed).
    "pino-pretty",
    "pino-elasticsearch",
    "tap",
    "desm",
    "fastbench",
    "why-is-node-running",
  ],

  /** Enables hot reloading for local packages without a build step */
  transpilePackages: [
    "@agentscope/agents",
    "@agentscope/api",
    "@agentscope/auth",
    "@agentscope/db",
    "@agentscope/observability",
    "@agentscope/telemetry",
    "@agentscope/ui",
    "pg",
  ],

  /** We already do linting and typechecking as separate tasks in CI */
  typescript: { ignoreBuildErrors: true },

  /**
   * Security headers — applied to every response.
   * See ops/runbook.md#security-headers for the rationale.
   */
  async headers() {
    const isProduction = process.env.NODE_ENV === "production";
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-site",
          },
          {
            key: "Strict-Transport-Security",
            value: isProduction
              ? "max-age=63072000; includeSubDomains; preload"
              : "max-age=0",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // NOTE: 'unsafe-inline' is currently required because Next.js
              // emits inline <script> tags for hydration and route announcers
              // that we cannot nonce without disabling its optimization paths.
              // Migrate to nonce-based CSP once Next.js middleware nonce
              // support is enabled. 'unsafe-eval' is intentionally NOT
              // included; dev builds use webpack which does not require it.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              // Only allow localhost Splunk connect in development to avoid
              // whitelisting arbitrary cross-origin localhost in production.
              ...(isProduction
                ? []
                : ["connect-src 'self' https://localhost:8089 http://localhost:8088"]),
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
      {
        source: "/api/streams/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-transform" },
          { key: "X-Accel-Buffering", value: "no" },
        ],
      },
    ];
  },
};

export default config;
