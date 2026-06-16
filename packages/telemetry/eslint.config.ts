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
  {
    // Test files dynamically import modules under controlled env-var
    // state to exercise the MCP reconnect backoff and heartbeat paths.
    // The dynamic-imports return `any` and the test bodies assert on
    // observable side-effects (status fields, error strings) rather
    // than the imported types, so the strict `no-unsafe-*` rules are
    // relaxed for this folder. Production code in `src/` is unaffected.
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/prefer-optional-chain": "off",
    },
  },
);
