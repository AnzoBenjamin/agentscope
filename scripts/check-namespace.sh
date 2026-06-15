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
# Add a per-line marker `# agentscope:allow-namespace` to suppress
# a false positive (use sparingly — most matches are real bugs).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Search source files only. Exclude generated/build outputs and VCS
# metadata so a stale dist/ or .next/ tree from a previous build
# doesn't trigger a false positive.
EXCLUDES=(
  --exclude-dir=node_modules
  --exclude-dir=.next
  --exclude-dir=.turbo
  --exclude-dir=dist
  --exclude-dir=.git
  --exclude-dir=coverage
  --exclude-dir=.cache
)

INCLUDES=(
  --include='*.ts'
  --include='*.tsx'
  --include='*.js'
  --include='*.jsx'
  --include='*.mjs'
  --include='*.cjs'
  --include='*.json'
  --include='*.md'
)

# `|| true` so the script does not abort on the first grep call. We
# want the raw output, not a non-zero exit code.
RAW_HITS=$(
  grep -rnE '@acme/' "${INCLUDES[@]}" "${EXCLUDES[@]}" . 2>/dev/null || true
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
