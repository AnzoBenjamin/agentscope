import { defineConfig } from "eslint/config";

import { baseConfig, restrictEnvAccess } from "@agentscope/eslint-config/base";

export default defineConfig(
  {
    ignores: ["script/**"],
  },
  baseConfig,
  restrictEnvAccess,
);
