/**
 * Empty module stub for Turbopack `resolveAlias` targets.
 *
 * `thread-stream` (a transitive dep of `pino`) ships a `test/` directory
 * containing dev-only helpers (`tap`, `desm`, `fastbench`,
 * `why-is-node-running`, `pino-elasticsearch`, `pino-pretty`). They are
 * never imported at runtime, but Turbopack walks the whole `node_modules`
 * tree during bundling and tries to resolve them. Aliasing these
 * specifiers to this stub short-circuits the resolution without affecting
 * the actual runtime behavior of `pino`.
 *
 * `export {}` produces an empty ES module — the most idiomatic TypeScript
 * way to declare "this file has no exports". Turbopack resolves the stub
 * via the same module system as the target specifier, and an empty ES
 * module is the safest default for a no-op stub (no `module` global, no
 * lint suppression, no `.cjs` extension).
 */
export {};
