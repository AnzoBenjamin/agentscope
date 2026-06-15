import { createEnv } from "@t3-oss/env-core";
import { z } from "zod/v4";

export function authEnv() {
  return createEnv({
    server: {
      AUTH_DISCORD_ID: z.string().optional(),
      AUTH_DISCORD_SECRET: z.string().optional(),
      AUTH_SECRET:
        process.env.NODE_ENV === "production"
          ? z.string().min(1)
          : z.string().min(1).optional(),
      // Optional 64-char hex (32-byte) override for the agent API-key
      // encryption key. When set, takes precedence over the key derived
      // from AUTH_SECRET. Rotate independently by generating a new value
      // with `openssl rand -hex 32`.
      AGENTSCOPE_SECRETS_KEY: z
        .string()
        .regex(/^[0-9a-fA-F]{64}$/, "must be 64 hex characters (32 bytes)")
        .optional(),
      // Must include `"test"` to match the `nextjs` app's
      // `shared.NODE_ENV` schema. t3-env `extends` merges namespaces
      // (server / shared / client) independently, so a stricter parent
      // `server.NODE_ENV` wins over a more permissive child
      // `shared.NODE_ENV`. Without `"test"`, `next build` fails in CI
      // when `NODE_ENV=test` (set by some runners / test commands)
      // with `Invalid option: expected one of "development"|"production"`.
      // The auth package only checks `=== "production"` for the
      // AUTH_SECRET requirement, so accepting `"test"` is semantically
      // equivalent (treated as non-production).
      NODE_ENV: z.enum(["development", "production", "test"]).optional(),
    },
    runtimeEnv: process.env,
    // Skip only on `lint` — the build tree lacks most env vars, which
    // is unrelated to a real env-validation failure. CI must still
    // validate: a missing `AUTH_SECRET` should fail the build server
    // check, not silently propagate to production.
    skipValidation: process.env.npm_lifecycle_event === "lint",
  });
}
