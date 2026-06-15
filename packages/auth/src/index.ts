import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { oAuthProxy } from "better-auth/plugins";
import { createLogger } from "@agentscope/observability";

import { db } from "@agentscope/db/client";

const authLogger = createLogger("auth");

export function initAuth<
  TExtraPlugins extends BetterAuthPlugin[] = [],
>(options: {
  baseUrl: string;
  productionUrl: string;
  secret: string | undefined;

  discordClientId?: string;
  discordClientSecret?: string;
  emailAndPasswordEnabled?: boolean;
  extraPlugins?: TExtraPlugins;
}) {
  const hasDiscord = !!options.discordClientId && !!options.discordClientSecret;

  // Narrow types within the guard to avoid non-null assertions
  const discordClientId = options.discordClientId ?? "";
  const discordClientSecret = options.discordClientSecret ?? "";

  const config = {
    database: drizzleAdapter(db, {
      provider: "pg",
    }),
    baseURL: options.baseUrl,
    secret: options.secret,
    emailAndPassword: options.emailAndPasswordEnabled
      ? { enabled: true as const }
      : undefined,
    plugins: [
      oAuthProxy({
        productionURL: options.productionUrl,
      }),
      ...(options.extraPlugins ?? []),
    ],
    socialProviders: hasDiscord
      ? {
          discord: {
            clientId: discordClientId,
            clientSecret: discordClientSecret,
            redirectURI: `${options.productionUrl}/api/auth/callback/discord`,
          },
        }
      : undefined,
    onAPIError: {
      onError(error, ctx) {
        authLogger.error({ err: error, ctx }, "better-auth api error");
      },
    },
  } satisfies BetterAuthOptions;

  return betterAuth(config);
}

export type Auth = ReturnType<typeof initAuth>;
export type Session = Auth["$Infer"]["Session"];

// Re-export the per-agent API-key encryption helpers so consumers can
// `import { encryptSecret, decryptSecret } from "@agentscope/auth"` without
// needing the sub-path export to resolve in every consumer's tsconfig.
export {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from "./secrets";
