import { defineConfig } from "eslint/config";

import { baseConfig } from "@agentscope/eslint-config/base";
import { reactConfig } from "@agentscope/eslint-config/react";

export default defineConfig(
  {
    ignores: ["dist/**"],
  },
  baseConfig,
  reactConfig,
);
