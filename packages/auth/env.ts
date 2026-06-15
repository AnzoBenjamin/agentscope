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
      NODE_ENV: z.enum(["development", "production"]).optional(),
    },
    runtimeEnv: process.env,
    skipValidation:
      !!process.env.CI || process.env.npm_lifecycle_event === "lint",
  });
}
