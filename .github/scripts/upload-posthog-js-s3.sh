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

# tag_s3_objects: apply `public=true` tag to every object under a given prefix.
# `aws s3 cp` does not support `--tagging`, so we tag after upload via the
# low-level s3api. The tag is required by the bucket policy so Cloudflare can
# read objects without authenticated requests (see posthog-cloud-infra
# terraform/.../posthog-js/s3.tf).
tag_s3_objects() {
    local prefix="$1"
    echo "==> Tagging objects under s3://$BUCKET/$prefix with public=true"
    # --no-paginate fetches all pages; filter out the literal "None" AWS CLI
    # emits on empty results (--output text renders null as the string "None").
    aws s3api list-objects-v2 --bucket "$BUCKET" --prefix "$prefix" \
        --no-paginate --query 'Contents[].Key' --output text \
    | tr '\t' '\n' \
    | while read -r key; do
        [ -z "$key" ] || [ "$key" = "None" ] && continue
        aws s3api put-object-tagging --bucket "$BUCKET" --key "$key" \
            --tagging '{"TagSet":[{"Key":"public","Value":"true"}]}'
    done
}

# JS bundles (posthog-js SDK artifacts + toolbar.js). Content type is set
# explicitly to preserve the existing `application/javascript` behaviour.
aws s3 cp "$DIST_DIR/" "s3://$BUCKET/static/$VERSION/" \
    --recursive \
    --exclude "*" \
    --include "*.js" \
    --cache-control "public, max-age=31536000, immutable" \
    --content-type "application/javascript"

# The toolbar bundle ships a sibling CSS file and an `assets/` directory of
# fonts/SVGs/PNGs alongside toolbar.js. These only exist when the matching
# posthog/posthog build has run with TOOLBAR_PUBLIC_PATH set, so gate on
# their presence to keep the upload script forward- and backward-compatible
# (e.g. for releases that don't include a fresh toolbar build).
if [[ -f "$DIST_DIR/toolbar.css" ]]; then
    echo "==> Uploading toolbar.css"
    aws s3 cp "$DIST_DIR/toolbar.css" "s3://$BUCKET/static/$VERSION/toolbar.css" \
        --cache-control "public, max-age=31536000, immutable" \
        --content-type "text/css"
fi

if [[ -d "$DIST_DIR/assets" ]]; then
    echo "==> Uploading toolbar assets/ ($(find "$DIST_DIR/assets" -type f | wc -l | tr -d ' ') files)"
    # No explicit --content-type: let aws-cli infer from the extension so
    # each file gets the right type (image/svg+xml, image/png, font/woff,
    # font/woff2, etc.). aws-cli uses Python's mimetypes module which maps
    # all of these correctly.
    aws s3 cp "$DIST_DIR/assets/" "s3://$BUCKET/static/$VERSION/assets/" \
        --recursive \
        --cache-control "public, max-age=31536000, immutable"
fi

# Tag all uploaded objects with public=true so the bucket policy allows
# unauthenticated Cloudflare reads.
tag_s3_objects "static/$VERSION/"

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
