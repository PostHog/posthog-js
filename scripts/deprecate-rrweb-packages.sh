#!/usr/bin/env bash
#
# Deprecates the @posthog/rrweb* npm packages.
#
# These packages used to live in PostHog/posthog-rrweb but were moved into
# this monorepo (see PR #3510). The code is now bundled inside posthog-js,
# so external consumers should install posthog-js instead of importing
# the standalone packages.
#
# Re-running the script is safe: `npm deprecate` is idempotent.
#
# Usage:
#   scripts/deprecate-rrweb-packages.sh             # dry-run (prints commands, no side effects)
#   scripts/deprecate-rrweb-packages.sh --apply     # actually deprecate every version
#   scripts/deprecate-rrweb-packages.sh --apply --otp 123456
#   scripts/deprecate-rrweb-packages.sh --undeprecate --apply
#
# Requirements:
#   - npm CLI installed
#   - Logged in as a @posthog org member with publish rights (`npm whoami`)
#   - 2FA OTP if your account requires `auth-and-writes`

set -euo pipefail

PACKAGES=(
    '@posthog/rrweb'
    '@posthog/rrweb-types'
    '@posthog/rrweb-utils'
    '@posthog/rrdom'
    '@posthog/rrweb-snapshot'
    '@posthog/rrweb-record'
    '@posthog/rrweb-plugin-console-record'
)

MESSAGE='This package has been moved into posthog-js and is no longer maintained as a standalone package. Install posthog-js instead: https://www.npmjs.com/package/posthog-js'

apply=false
undeprecate=false
otp=''

while [[ $# -gt 0 ]]; do
    case "$1" in
        --apply)
            apply=true
            shift
            ;;
        --undeprecate)
            undeprecate=true
            shift
            ;;
        --otp)
            otp="$2"
            shift 2
            ;;
        --otp=*)
            otp="${1#--otp=}"
            shift
            ;;
        -h|--help)
            sed -n '3,21p' "$0" | sed 's|^# \{0,1\}||'
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            exit 64
            ;;
    esac
done

if [[ "$undeprecate" == true ]]; then
    msg=''
    action='Undeprecating'
else
    msg="$MESSAGE"
    action='Deprecating'
fi

if [[ "$apply" != true ]]; then
    echo
    echo '!!! Dry run — no packages will be modified. Re-run with --apply to execute. !!!'
    echo
fi

# Sanity check: confirm npm login state, but don't block in dry-run.
if [[ "$apply" == true ]]; then
    if ! whoami_output=$(npm whoami 2>&1); then
        echo "ERROR: not logged in to npm. Run \`npm login\` first." >&2
        echo "  npm whoami output: $whoami_output" >&2
        exit 1
    fi
    echo "Logged in to npm as: $whoami_output"
    echo
fi

failed=()
for pkg in "${PACKAGES[@]}"; do
    echo "=== $action $pkg ==="

    cmd=(npm deprecate "$pkg" "$msg")
    if [[ -n "$otp" ]]; then
        cmd+=(--otp="$otp")
    fi

    if [[ "$apply" != true ]]; then
        printf '  (dry-run) '
        printf '%q ' "${cmd[@]}"
        printf '\n'
        continue
    fi

    if ! "${cmd[@]}"; then
        echo "  FAILED to $action $pkg" >&2
        failed+=("$pkg")
        continue
    fi

    # Verify by reading back the deprecation field for the latest version.
    current=$(npm view "$pkg" deprecated 2>/dev/null || true)
    if [[ "$undeprecate" == true ]]; then
        if [[ -z "$current" ]]; then
            echo "  OK: $pkg is no longer deprecated"
        else
            echo "  WARN: $pkg still reports deprecated='$current'" >&2
        fi
    else
        if [[ -n "$current" ]]; then
            echo "  OK: $pkg deprecated"
        else
            echo "  WARN: $pkg did not report a deprecated field after deprecate" >&2
        fi
    fi
done

echo
if [[ ${#failed[@]} -gt 0 ]]; then
    echo "Failed packages:"
    printf '  - %s\n' "${failed[@]}"
    exit 1
fi
echo "Done."
