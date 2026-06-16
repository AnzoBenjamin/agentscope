import { defineConfig } from "eslint/config";

import { baseConfig } from "@agentscope/eslint-config/base";

export default defineConfig(
  {
    ignores: ["dist/**", "scripts/**"],
  },
  baseConfig,
  {
    // Test files dynamically import the client module under controlled
    // env-var state to exercise the `intEnv` fallback paths. The
    // dynamic imports return `any` and the test bodies assert on
    // observable side-effects (the exported `closeDb` function shape)
    // rather than the imported types, so the strict `no-unsafe-*`
    // rules are relaxed for this folder. Production code in `src/`
    // is unaffected.
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
);
