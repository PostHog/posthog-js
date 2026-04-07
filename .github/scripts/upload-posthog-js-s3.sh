#!/usr/bin/env bash
#
# Upload posthog-js dist artifacts to S3 and append the version to versions.json.
#
# Usage:
#   VERSION=1.365.0 ./upload-posthog-js-s3.sh <bucket>
#
# VERSION must be set as an environment variable (not an argument) to avoid
# shell injection if the value were ever attacker-influenced.
#
# Expects AWS credentials to be configured before invocation.
#
set -euo pipefail

BUCKET="${1:?Usage: VERSION=x.y.z $0 <bucket>}"
DIST_DIR="packages/browser/dist"

if [[ -z "${VERSION:-}" ]]; then
    echo "ERROR: VERSION environment variable is required" >&2
    exit 1
fi

# Validate version is strict semver (e.g. 1.365.0 or 1.365.0-beta.1).
# Prevents path traversal — no slashes, dots only in expected positions.
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-][a-zA-Z0-9.]+)?$ ]]; then
    echo "ERROR: Invalid version format: '$VERSION'" >&2
    exit 1
fi

echo "==> Uploading posthog-js v$VERSION to s3://$BUCKET/static/$VERSION/"
aws s3 cp "$DIST_DIR/" "s3://$BUCKET/static/$VERSION/" \
    --recursive \
    --exclude "*" \
    --include "*.js" \
    --cache-control "public, max-age=31536000, immutable" \
    --content-type "application/javascript"

echo "==> Updating versions.json in s3://$BUCKET/"
TMPWORKDIR="$(mktemp -d)"
trap 'rm -rf "$TMPWORKDIR"' EXIT

# Distinguish "file doesn't exist" from real errors (auth, network).
# A blind fallback to '[]' on any error would silently drop all previous versions.
if aws s3 cp "s3://$BUCKET/versions.json" "$TMPWORKDIR/versions.json"; then
    echo "Downloaded existing versions.json"
elif aws s3api head-object --bucket "$BUCKET" --key "versions.json" 2>/dev/null; then
    echo "ERROR: versions.json exists but could not be downloaded" >&2
    exit 1
else
    echo "No existing versions.json found, starting fresh"
    echo '[]' > "$TMPWORKDIR/versions.json"
fi

if jq -e --arg v "$VERSION" '.[] | select(.version == $v)' "$TMPWORKDIR/versions.json" > /dev/null 2>&1; then
    echo "Version $VERSION already in versions.json, skipping"
else
    jq --arg v "$VERSION" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        '. + [{"version": $v, "timestamp": $ts}]' "$TMPWORKDIR/versions.json" > "$TMPWORKDIR/versions_updated.json"

    # Validate the updated manifest before uploading: must be a non-empty JSON array
    # where every entry has .version and .timestamp strings, and length is exactly original + 1.
    EXPECTED_LENGTH=$(( $(jq 'length' "$TMPWORKDIR/versions.json") + 1 ))
    if ! jq -e --argjson expected "$EXPECTED_LENGTH" 'if type != "array" then error
        elif length != $expected then error
        elif any(.[]; (.version | type) != "string" or (.timestamp | type) != "string") then error
        else true end' "$TMPWORKDIR/versions_updated.json" > /dev/null 2>&1; then
        echo "ERROR: versions_updated.json failed validation — aborting upload" >&2
        cat "$TMPWORKDIR/versions_updated.json" >&2
        exit 1
    fi

    aws s3 cp "$TMPWORKDIR/versions_updated.json" "s3://$BUCKET/versions.json" \
        --content-type "application/json"
    echo "Added v$VERSION to versions.json"
fi
