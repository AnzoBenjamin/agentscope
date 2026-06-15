import { execSync } from "node:child_process";
import type { PlopTypes } from "@turbo/gen";

interface PackageJson {
  name: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

/**
 * The canonical workspace scope for AgentScope packages. Hardcoded here so
 * the smoke test in `config.test.ts` can fail loudly if a future refactor
 * tries to reintroduce a different scope (e.g. `@acme/`, `@example/`).
 */
export const WORKSPACE_SCOPE = "@agentscope";

/**
 * Normalize a user-supplied package name to the bare directory name used
 * under `packages/`. Accepts:
 *   - `foo`                        -> `foo`
 *   - `@agentscope/foo`            -> `foo`
 *
 * Rejects (throws) any input that:
 *   - Uses a different scope (e.g. `@acme/foo`, `@scope/foo`) so a typo
 *     can't silently scaffold a package under the wrong namespace.
 *   - Is empty, whitespace, or contains path traversal (`..`, `/`).
 *
 * Scoped inputs are checked for the correct scope BEFORE the path-traversal
 * guard, so `@acme/foo` fails with a clear "scope must be @agentscope/"
 * message rather than a misleading "path traversal" one.
 */
export function normalizePackageName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error(`Package name must be a string, got ${typeof raw}`);
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new Error("Package name cannot be empty");
  }
  if (trimmed.startsWith("@")) {
    // Scoped input: validate the scope first, then the body.
    const slash = trimmed.indexOf("/");
    if (slash < 0) {
      throw new Error(
        `Scoped package name "${trimmed}" is missing the trailing slash`,
      );
    }
    const scope = trimmed.slice(0, slash);
    if (scope !== WORKSPACE_SCOPE) {
      throw new Error(
        `Package scope must be ${WORKSPACE_SCOPE}/, got ${scope}/. ` +
          `Re-run the generator without the @ prefix to let the workspace scope be added automatically.`,
      );
    }
    const body = trimmed.slice(slash + 1);
    if (body === "") {
      throw new Error(`Package name "${trimmed}" has an empty body`);
    }
    if (body.includes("/") || body.includes("..")) {
      throw new Error(
        `Package name "${trimmed}" contains path traversal characters`,
      );
    }
    return body;
  }
  // Unscoped input: must be a single path segment.
  if (trimmed.includes("/") || trimmed.includes("..")) {
    throw new Error(
      `Package name "${trimmed}" contains path traversal characters`,
    );
  }
  return trimmed;
}

export default function generator(plop: PlopTypes.NodePlopAPI): void {
  plop.setGenerator("init", {
    description: "Generate a new package for the AgentScope Monorepo",
    prompts: [
      {
        type: "input",
        name: "name",
        message:
          "What is the name of the package? (You can skip the `@agentscope/` prefix)",
      },
      {
        type: "input",
        name: "deps",
        message:
          "Enter a space separated list of dependencies you would like to install",
      },
    ],
    actions: [
      (answers) => {
        if ("name" in answers) {
          answers.name = normalizePackageName(answers.name);
        }
        return "Config sanitized";
      },
      {
        type: "add",
        path: "packages/{{ name }}/eslint.config.ts",
        templateFile: "templates/eslint.config.ts.hbs",
      },
      {
        type: "add",
        path: "packages/{{ name }}/package.json",
        templateFile: "templates/package.json.hbs",
      },
      {
        type: "add",
        path: "packages/{{ name }}/tsconfig.json",
        templateFile: "templates/tsconfig.json.hbs",
      },
      {
        type: "add",
        path: "packages/{{ name }}/src/index.ts",
        template: "export const name = '{{ name }}';",
      },
      {
        type: "modify",
        path: "packages/{{ name }}/package.json",
        async transform(content, answers) {
          if ("deps" in answers && typeof answers.deps === "string") {
            const pkg = JSON.parse(content) as PackageJson;
            for (const dep of answers.deps.split(" ").filter(Boolean)) {
              const version = await fetch(
                `https://registry.npmjs.org/-/package/${dep}/dist-tags`,
              )
                .then((res) => res.json() as unknown as { latest: string })
                .then((json) => json.latest);
              if (!pkg.dependencies) pkg.dependencies = {};
              pkg.dependencies[dep] = `^${version}`;
            }
            return JSON.stringify(pkg, null, 2);
          }
          return content;
        },
      },
      async (answers) => {
        /**
         * Install deps and format everything
         */
        if ("name" in answers && typeof answers.name === "string") {
          // execSync("pnpm dlx sherif@latest --fix", {
          //   stdio: "inherit",
          // });
          execSync("pnpm i", { stdio: "inherit" });
          execSync(
            `pnpm prettier --write packages/${answers.name}/** --list-different`,
          );
          return "Package scaffolded";
        }
        return "Package not scaffolded";
      },
    ],
  });
}
