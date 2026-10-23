#!/usr/bin/env bash
# Run the error tracking harness (PostHog/error-tracking-harness) against this checkout's plugins.
# From the repository root: tooling/error-tracking-harness/run-ci.sh <absolute artifact directory> [harness args...]
#
# HARNESS_IMAGE must be the digest-pinned image: a tag could change under CI, a digest cannot.
# The harness runs with no network; the packed plugins are the only thing it sees from here.
set -euo pipefail
artifacts=${1:?absolute artifact directory required}
shift
[[ "$artifacts" = /* ]] || { echo 'Absolute artifact directory required' >&2; exit 2; }
mkdir -p "$artifacts"

if [[ ! "${HARNESS_IMAGE:-}" =~ ^ghcr\.io/posthog/error-tracking-harness@sha256:[0-9a-f]{64}$ ]]; then
    echo 'HARNESS_IMAGE must be ghcr.io/posthog/error-tracking-harness@sha256:<64 lowercase hex digits>.' >&2
    exit 2
fi
printf 'HARNESS_IMAGE=%s\n' "$HARNESS_IMAGE" > "$artifacts/image.txt"
git rev-parse HEAD > "$artifacts/source.txt"

# The plugins under test and the SDKs they are tested with. `package` builds their dependencies
# and packs every workspace package they need, so the harness overlays a complete set.
export PACKAGE_DEST="$PWD/target"
rm -rf "$PACKAGE_DEST"
pnpm turbo run package \
    --filter=@posthog/webpack-plugin --filter=@posthog/rollup-plugin \
    --filter=@posthog/nextjs-config --filter=@posthog/nuxt \
    --filter=posthog-node --filter=posthog-js
ls "$PACKAGE_DEST" > "$artifacts/subject.txt"

docker pull "$HARNESS_IMAGE"
docker run --rm --network none \
    -v "$PACKAGE_DEST:/subject:ro" -v "$artifacts:/artifacts" \
    "$HARNESS_IMAGE" --artifacts /artifacts --plugins subject "$@"
