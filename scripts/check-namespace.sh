#!/usr/bin/env bash
# scripts/check-namespace.sh
#
# Fails if any source file references the legacy @acme/ scope.
# The AgentScope monorepo uses @agentscope/* — @acme/* is a leftover
# from the T3 scaffold this repo was forked from, and should never
# appear in a fresh clone.
#
# The husky pre-commit hook runs this, and CI runs it on every push.
# Run it manually with:
#
#   bash scripts/check-namespace.sh
#
# Suppression mechanisms (use sparingly — most matches are real bugs):
#   1. Add the path to the `INTENTIONAL_EXCLUDES` list below with a
#      comment explaining why the exclusion is safe. This is the
#      approach CONTRIBUTING.md promises for files that legitimately
#      reference @acme/ (e.g. the generator's test inputs that verify
#      the guard rejects the wrong scope).
#   2. Add a per-line marker `# agentscope:allow-namespace` to suppress
#      a single false positive on a line that should keep its @acme/
#      reference verbatim.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Generated/build outputs, VCS metadata, and tool caches. A stale
# dist/ or .next/ tree from a previous build, a tool-generated
# index cache, or a tool session state file would trigger false
# positives (the session state frequently quotes the @acme/ scope
# in task descriptions and error messages, which is expected).
DIR_EXCLUDES=(
  -type d \( -name node_modules -o -name .next -o -name .turbo -o -name dist -o -name .git -o -name coverage -o -name .cache -o -name .codebuff-index -o -name .omx \) -prune
)

# File extensions to search. Mirrors the t3-env scaffold's defaults
# plus .md for documentation.
FILE_INCLUDES=(
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' -o -name '*.json' -o -name '*.md' \)
)

# Well-known files that legitimately reference @acme/ as part of
# exercising or documenting the namespace lockdown. The script's
# contract (per CONTRIBUTING.md) is to skip these. Each entry MUST
# have a comment explaining why the exclusion is safe — if a future
# contributor can't see the rationale in this file, the exclusion
# will silently rot.
INTENTIONAL_EXCLUDES=(
  # CONTRIBUTING.md documents the lockdown and shows @acme/ as the
  # example of what NOT to use. The surrounding prose is the spec.
  -not -path './CONTRIBUTING.md'
  # turbo/generators/config.ts doc-comments describe the scope-rejection
  # guard and cite @acme/ as the example of a wrong scope. Removing
  # the citation would make the guard's contract less clear.
  -not -path './turbo/generators/config.ts'
  # turbo/generators/config.test.ts is the authoritative guard for the
  # generator tree — it intentionally feeds @acme/foo to
  # normalizePackageName to assert the guard rejects it. The unit
  # tests in this file are the real lockdown, not the grep.
  -not -path './turbo/generators/config.test.ts'
)

# `|| true` so the script does not abort on the first grep call. We
# want the raw output, not a non-zero exit code.
RAW_HITS=$(
  find . \
    "${DIR_EXCLUDES[@]}" \
    -o "${FILE_INCLUDES[@]}" "${INTENTIONAL_EXCLUDES[@]}" -print \
    2>/dev/null \
  | xargs grep -nE '@acme/' 2>/dev/null || true
)

# Strip out lines that have the explicit allow marker.
FILTERED_HITS=$(
  printf '%s\n' "$RAW_HITS" | grep -vE 'agentscope:allow-namespace' || true
)

if [ -n "$FILTERED_HITS" ]; then
  echo "ERROR: Found @acme/ references in the source tree." >&2
  echo "Use @agentscope/* instead — see CONTRIBUTING.md." >&2
  echo "" >&2
  echo "Offending matches (use \`# agentscope:allow-namespace\` to suppress):" >&2
  echo "$FILTERED_HITS" >&2
  exit 1
fi

echo "Namespace check passed (no @acme/ references)."
