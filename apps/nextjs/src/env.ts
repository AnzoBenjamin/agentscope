import { createEnv } from "@t3-oss/env-nextjs";
import { vercel } from "@t3-oss/env-nextjs/presets-zod";
import { z } from "zod/v4";

import { authEnv } from "@agentscope/auth/env";

export const env = createEnv({
  extends: [authEnv(), vercel()],
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  /**
   * Specify your server-side environment variables schema here.
   * This way you can ensure the app isn't built with invalid env vars.
   */
  server: {
    POSTGRES_URL: z.url(),
  },

  /**
   * Specify your client-side environment variables schema here.
   * For them to be exposed to the client, prefix them with `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  },
  /**
   * Destructure all variables from `process.env` to make sure they aren't tree-shaken away.
   */
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  // The `lint` lifecycle event runs against the build tree where many
  // env vars are unset, so the schema can't resolve and would fail
  // the lint job for unrelated reasons. We do NOT skip in CI: a
  // missing `POSTGRES_URL` should fail the build server check, not
  // silently propagate to production. The original t3-env scaffold
  // skipped both `CI` and `lint`; the CI branch was a misconfiguration
  // that masked a recurring production deploy bug (see code review,
  // June 2026).
  skipValidation: process.env.npm_lifecycle_event === "lint",
});
