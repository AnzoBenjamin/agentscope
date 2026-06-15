import { baseConfig } from "@agentscope/eslint-config/base";

export default [
  ...baseConfig,
  {
    ignores: ["dist/**", ".cache/**", ".turbo/**"],
  },
];
