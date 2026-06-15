import { defineConfig } from "eslint/config";

import { baseConfig } from "@agentscope/eslint-config/base";

export default defineConfig(
  baseConfig,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // env vars are declared in root turbo.json; plugin resolution is broken in workspace packages
      "turbo/no-undeclared-env-vars": "off",
    },
  },
);
