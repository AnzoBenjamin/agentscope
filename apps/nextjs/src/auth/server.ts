import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { nextCookies } from "better-auth/next-js";

import { initAuth } from "@agentscope/auth";

import { env } from "~/env";

const baseUrl =
  env.VERCEL_ENV === "production"
    ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`
    : env.VERCEL_ENV === "preview"
      ? `https://${env.VERCEL_URL}`
      : "http://localhost:3000";

// Better Auth's `productionUrl` is used to build absolute OAuth callback
// URLs. Silently defaulting to a real-looking domain (`agentscope.dev`)
// would mean a misconfigured *production* deploy quietly redirect
// users to a third party they don't own — hard-fail in production so
// the operator sees the misconfiguration during `next build` instead
// of at OAuth time. In non-production environments the var is unset
// (local dev has neither VERCEL_PROJECT_PRODUCTION_URL nor VERCEL_URL
// in a meaningful state), so we mirror `baseUrl` and fall through to
// localhost/preview to keep `pnpm dev` working.
let productionUrl: string;
if (env.VERCEL_ENV === "production") {
  if (!env.VERCEL_PROJECT_PRODUCTION_URL) {
    throw new Error(
      "VERCEL_PROJECT_PRODUCTION_URL is required so Better Auth can build absolute OAuth callback URLs. Set it in your deployment environment.",
    );
  }
  productionUrl = `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
} else {
  productionUrl = baseUrl;
}

export const auth = initAuth({
  baseUrl,
  productionUrl,
  secret: env.AUTH_SECRET,
  // Better Auth ignores empty social provider fields, but the
  // `socialProviders` map is cleaner when unset values are actually
  // `undefined` (so the key is omitted from the config object) than when
  // they are empty strings that downstream code has to re-check.
  discordClientId: env.AUTH_DISCORD_ID ?? undefined,
  discordClientSecret: env.AUTH_DISCORD_SECRET ?? undefined,
  emailAndPasswordEnabled: true,
  extraPlugins: [nextCookies()],
});

export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);
