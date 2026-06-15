import { defineConfig } from "eslint/config";

import { baseConfig, restrictEnvAccess } from "@agentscope/eslint-config/base";
import { nextjsConfig } from "@agentscope/eslint-config/nextjs";
import { reactConfig } from "@agentscope/eslint-config/react";

export default defineConfig(
  {
    ignores: [".next/**", "scripts/stubs/**"],
  },
  baseConfig,
  reactConfig,
  nextjsConfig,
  restrictEnvAccess,
);
