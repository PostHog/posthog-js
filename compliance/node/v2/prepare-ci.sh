#!/usr/bin/env bash
# Run from the repository root. CI retains this directory even when preparation fails.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
artifacts=${1:?absolute artifact directory required}
[[ "$artifacts" = /* ]] || { echo 'Absolute artifact directory required' >&2; exit 2; }
mkdir -p "$artifacts"
trap 'printf "%s\n" "$?" > "$artifacts/prepare-exit.txt"' EXIT
git rev-parse HEAD > "$artifacts/source.txt"
git status --short > "$artifacts/source-status.txt"

# Docker repository components, optional registry port and tag, then a full SHA-256.
component='[a-z0-9]+(([._]|__|-+)[a-z0-9]+)*'
repository="([a-z0-9]+([.-][a-z0-9]+)*(:[0-9]+)?/)?$component(/$component)*"
if [[ ! "${NODE_IMAGE:-}" =~ ^$repository(:[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127})?@sha256:[0-9a-f]{64}$ ]]; then
    echo 'NODE_IMAGE must contain a valid digest-pinned Node 24 image (repository@sha256:64-lowercase-hex-digits).' >&2
    exit 2
fi
if [[ ! "${HARNESS_IMAGE:-}" =~ ^ghcr\.io/posthog/sdk-test-harness-v2@sha256:[0-9a-f]{64}$ ]]; then
    echo 'HARNESS_IMAGE must contain the released ghcr.io/posthog/sdk-test-harness-v2@sha256:64-lowercase-hex-digits image.' >&2
    exit 2
fi
printf 'NODE_IMAGE=%s\nHARNESS_IMAGE=%s\n' "$NODE_IMAGE" "$HARNESS_IMAGE" > "$artifacts/images.txt"
node "$script_dir/run-command.mjs" 180000 docker pull "$HARNESS_IMAGE"
node "$script_dir/run-command.mjs" 900000 docker build --progress=plain \
    --file compliance/node/v2/Dockerfile --build-arg "NODE_IMAGE=$NODE_IMAGE" \
    --build-arg "SOURCE_REVISION=$(cat "$artifacts/source.txt")" --tag node-compliance:local .
node "$script_dir/run-command.mjs" 30000 docker run --rm --network none \
    --entrypoint cat node-compliance:local /build.json > "$artifacts/build.json"
