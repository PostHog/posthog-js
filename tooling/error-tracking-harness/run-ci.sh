#!/usr/bin/env bash
# Run the error tracking harness (PostHog/error-tracking-harness) against this checkout's plugins.
# From the repository root: tooling/error-tracking-harness/run-ci.sh <absolute artifact directory> [--fixtures names] [harness args...]
#
# HARNESS_IMAGE must be the digest-pinned image: a tag could change under CI, a digest cannot.
# The image build resolves selected tarballs once; the test run has no network.
set -euo pipefail
artifacts=${1:?absolute artifact directory required}
shift
[[ "$artifacts" = /* ]] || { echo 'Absolute artifact directory required' >&2; exit 2; }
mkdir -p "$artifacts"

# Prepare exactly the fixture set whose PR-built dependencies will enter the image.
fixtures='next-14,next-15,next-16-turbopack,next-16-webpack,nuxt-4,rollup-4,vite-8,vite-8-sri,vite-8-autocapture,webpack-5.112,webpack-5.112-sri'
args=()
while (( $# )); do
    case "$1" in
        --fixtures)
            [[ $# -ge 2 ]] || { echo '--fixtures needs a value' >&2; exit 2; }
            fixtures=$2; shift 2 ;;
        --fixtures=*) fixtures=${1#*=}; shift ;;
        --tags|--tags=*) echo 'Use --fixtures when building a prepared subject image, not --tags.' >&2; exit 2 ;;
        *) args+=("$1"); shift ;;
    esac
done
IFS=, read -r -a names <<< "$fixtures"
(( ${#names[@]} > 0 )) || { echo 'Empty fixture selection' >&2; exit 2; }
# Bind the workspace dependency closure of each fixture. Packing without installing
# would silently exercise baked releases instead of this checkout's SDKs and utilities.
overrides=()
add_overrides() {
    for package in "$@"; do
        if [[ ! " ${overrides[*]} " == *" $package "* ]]; then overrides+=("$package"); fi
    done
}
for fixture in "${names[@]}"; do
    case "$fixture" in
        next-14|next-15|next-16-turbopack|next-16-webpack)
            add_overrides @posthog/nextjs-config @posthog/webpack-plugin @posthog/plugin-utils \
                posthog-node posthog-js @posthog/browser-common @posthog/core @posthog/types ;;
        nuxt-4)
            add_overrides @posthog/nuxt @posthog/plugin-utils posthog-node posthog-js \
                @posthog/browser-common @posthog/core @posthog/types ;;
        rollup-4|vite-8)
            add_overrides @posthog/rollup-plugin @posthog/plugin-utils posthog-node @posthog/core @posthog/types ;;
        vite-8-autocapture|vite-8-sri)
            add_overrides @posthog/rollup-plugin @posthog/plugin-utils posthog-js \
                @posthog/browser-common @posthog/core @posthog/types ;;
        webpack-5.112|webpack-5.112-sri)
            add_overrides @posthog/webpack-plugin @posthog/plugin-utils posthog-node @posthog/core @posthog/types ;;
        *) echo "Unsupported fixture for local overrides: $fixture" >&2; exit 2 ;;
    esac
done
# The npm CLI shim is a plugin dependency, separate from the selected CLI binary.
# Installation needs its tarball even though the harness passes cliBinaryPath
# explicitly and never executes the shim's postinstall download.
add_overrides @posthog/cli
filters=()
for package in "${overrides[@]}"; do
    if [[ "$package" != @posthog/cli ]]; then filters+=("--filter=$package"); fi
done

if [[ ! "${HARNESS_IMAGE:-}" =~ ^ghcr\.io/posthog/error-tracking-harness@sha256:[0-9a-f]{64}$ ]]; then
    echo 'HARNESS_IMAGE must be ghcr.io/posthog/error-tracking-harness@sha256:<64 lowercase hex digits>.' >&2
    exit 2
fi
printf 'HARNESS_IMAGE=%s\n' "$HARNESS_IMAGE" > "$artifacts/image.txt"
git rev-parse HEAD > "$artifacts/source.txt"

# Pack the entire selected workspace closure. Turbo builds its dependencies first.
export PACKAGE_DEST="$PWD/target"
rm -rf "$PACKAGE_DEST"
pnpm turbo run package "${filters[@]}"
# @posthog/cli is published outside this workspace and intentionally exempt from
# the repository's release-age cooldown. Pack exactly the catalog version, not latest.
cli_version=$(node <<'NODE'
const { readFileSync } = require('node:fs')
const match = readFileSync('pnpm-workspace.yaml', 'utf8').match(/^\s*['"]@posthog\/cli['"]:\s*~(\d+\.\d+\.\d+)\s*$/m)
if (!match) throw new Error('Expected a tilde-pinned @posthog/cli catalog version')
process.stdout.write(match[1])
NODE
)
npm --prefix "$artifacts" pack "@posthog/cli@$cli_version" --pack-destination "$PACKAGE_DEST" --ignore-scripts --silent
ls "$PACKAGE_DEST" > "$artifacts/subject.txt"

# Stage only selected tarballs in the Docker context (never the repository or secrets).
context="$artifacts/subject-context"
rm -rf "$context"
mkdir -p "$context"
node - "$PACKAGE_DEST" "$context" "${overrides[@]}" <<'NODE'
const { execFileSync } = require('node:child_process')
const { copyFileSync, readdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const directory = process.argv[2]
const context = process.argv[3]
const expected = new Set(process.argv.slice(4))
const packages = {}
for (const file of readdirSync(directory).filter((name) => name.endsWith('.tgz'))) {
    const manifest = JSON.parse(execFileSync('tar', ['-xzOf', path.join(directory, file), 'package/package.json'], { encoding: 'utf8' }))
    if (!expected.has(manifest.name)) continue
    if (packages[manifest.name]) throw new Error(`Duplicate tarball for ${manifest.name}`)
    packages[manifest.name] = `/subject/${file}`
    copyFileSync(path.join(directory, file), path.join(context, file))
}
const missing = [...expected].filter((name) => !packages[name])
if (missing.length) throw new Error(`Missing override tarballs: ${missing.join(', ')}`)
writeFileSync(path.join(context, 'overrides.json'), JSON.stringify({ packages }, null, 2) + '\n')
NODE

# Network access is limited to this trusted image build; runtime has none.
image="error-tracking-harness:subject-$(git rev-parse --short=12 HEAD)-${GITHUB_RUN_ID:-local}"
docker pull "$HARNESS_IMAGE"
docker build -f tooling/error-tracking-harness/Dockerfile.subject \
    --build-arg "HARNESS_IMAGE=$HARNESS_IMAGE" --build-arg "FIXTURES=$fixtures" \
    -t "$image" "$context"
docker run --rm --network none -v "$artifacts:/artifacts" \
    "$image" --artifacts /artifacts --fixtures "$fixtures" "${args[@]}"
