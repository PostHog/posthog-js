#!/usr/bin/env bash
set -euo pipefail

credential_loader="${POSTHOG_REAL_TEST_CREDENTIAL_LOADER:-$HOME/.pi/agent/skills/testing-real-posthog-instance/scripts/load_credentials.sh}"

if [[ -z "${POSTHOG_TEST_PROJECT_TOKEN:-}" && -f "$credential_loader" ]]; then
    # The approved loader reads the existing environment first and then macOS Keychain.
    # It does not print credentials.
    source "$credential_loader"
fi

if [[ -z "${POSTHOG_TEST_PROJECT_TOKEN:-}" ]]; then
    echo "POSTHOG_TEST_PROJECT_TOKEN is not set and no credential was available from the approved loader." >&2
    echo "Export POSTHOG_TEST_PROJECT_TOKEN, then retry." >&2
    exit 1
fi

export POSTHOG_REAL_TESTS=1
export POSTHOG_TEST_REGION="${POSTHOG_TEST_REGION:-US}"
export POSTHOG_TEST_PROJECT_ID="${POSTHOG_TEST_PROJECT_ID:-225020}"
export POSTHOG_TEST_WEB_URL="${POSTHOG_TEST_WEB_URL:-https://us.posthog.com/project/225020}"
export POSTHOG_TEST_HOST="${POSTHOG_TEST_HOST:-https://us.i.posthog.com}"

# Vite exposes only the public project token and public project URLs to the browser.
# The optional personal API key is intentionally not copied into a VITE_* variable.
export VITE_POSTHOG_PROJECT_TOKEN="$POSTHOG_TEST_PROJECT_TOKEN"
export VITE_POSTHOG_HOST="$POSTHOG_TEST_HOST"
export VITE_POSTHOG_WEB_URL="$POSTHOG_TEST_WEB_URL"

exec pnpm exec vite --host 127.0.0.1 "$@"
