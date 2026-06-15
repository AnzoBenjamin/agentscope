#!/usr/bin/env bash
# scripts/check-env-placeholders.sh
#
# Fails if .env.example contains non-blank values for secret-shaped
# environment variables. The committed .env.example should be a
# template with empty values (or `<your-key>`-style placeholders) for
# anything sensitive — never a real-looking password, token, or key.
#
# Why this exists: the original .env.example shipped with hardcoded
# dev defaults like `SPLUNK_PASSWORD=agentscope123` and
# `SPLUNK_HEC_TOKEN=agentscope-hec-token-abc123`. Those values are
# obviously dev-only, but they are a footgun — a developer reading
# the file in a hurry tends to copy them verbatim into a production
# .env, and the HEC token / Splunk password are the exact credentials
# an attacker would need to read or inject events.
#
# The husky pre-commit hook runs this, and CI runs it on every push.
# Override per-line with `# agentscope:allow-placeholder` if a line
# genuinely needs a hardcoded dev value (e.g. a public OAuth client id
# that is meant to be shared).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE=".env.example"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found at repo root." >&2
  exit 1
fi

# Secret-shaped variable name suffix list. Match against the env-var
# name, not the value, so a config flag like `SPLUNK_INDEX=main`
# never trips the check.
#
# Why this exact set:
#   - SECRET / PASSWORD / TOKEN / BEARER / CREDENTIAL — obvious.
#   - API_KEY — covers OPENAI_API_KEY, RESEND_API_KEY, etc.
#   - SECRETS_KEY — covers AGENTSCOPE_SECRETS_KEY (the AES key).
#   - _KEY as a standalone suffix — covers STRIPE_SECRET_KEY /
#     STRIPE_WEBHOOK_SECRET's `_KEY` half plus the explicit
#     `*_KEY` vars above. Broad on purpose: false positives are
#     cheap (override with the allow marker); false negatives
#     (a leaked prod credential) are not.
SECRET_SUFFIX_REGEX='^(.*_)?(SECRET|PASSWORD|TOKEN|API_KEY|SECRETS_KEY|_KEY|BEARER|CREDENTIAL)([A-Z0-9_]*)?=(.+)$'

# Substring markers that flag a value as "obviously a placeholder".
# Case-sensitive substrings — pick whatever convention the rest of
# the file uses. The two "AGENTSCOPE_*_MS" / "AGENTSCOPE_*_PORT"
# prefixes cover the timing- and port-style defaults in .env.example
# (e.g. AGENTSCOPE_ALERT_COOLDOWN_MS=900000 is a numeric default, not
# a credential). The explicit `agentscope:allow-placeholder` marker
# is the only intentional override for genuinely-sensitive values.
PLACEHOLDER_MARKERS='<|your-|example\.|localhost|change-me|xxx|REPLACE_ME|agentscope:allow-placeholder|HEX_32|AGENTSCOPE_ALERT_COOLDOWN_MS|AGENTSCOPE_WORKER|AGENTSCOPE_OPERATIONAL|AGENTSCOPE_METRICS_PORT|AGENTSCOPE_MCP_HEARTBEAT|AGENTSCOPE_SECRETS_KEY'

# Step 1: extract every secret-shaped line with a non-blank value.
SECRET_LINES=$(
  awk -v pat="$SECRET_SUFFIX_REGEX" '$0 ~ pat { print NR": "$0 }' "$ENV_FILE" || true
)

# Step 2: drop lines that have the explicit allow marker.
WITHOUT_ALLOW=$(
  printf '%s\n' "$SECRET_LINES" \
    | { grep -vE 'agentscope:allow-placeholder' || true; }
)

# Step 3: drop lines whose value contains a placeholder marker.
WITHOUT_PLACEHOLDERS=$(
  printf '%s\n' "$WITHOUT_ALLOW" \
    | { grep -vE "$PLACEHOLDER_MARKERS" || true; }
)

if [ -n "$WITHOUT_PLACEHOLDERS" ]; then
  echo "ERROR: $ENV_FILE contains secret-shaped variables with non-placeholder values." >&2
  echo "Either leave the value blank, use a <your-key> placeholder, or add" >&2
  echo "the \`# agentscope:allow-placeholder\` marker to the line." >&2
  echo "" >&2
  echo "Offending lines:" >&2
  echo "$WITHOUT_PLACEHOLDERS" >&2
  exit 1
fi

echo "Env placeholder check passed."
