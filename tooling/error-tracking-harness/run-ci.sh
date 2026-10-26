#!/usr/bin/env bash
# Run the error tracking harness (PostHog/error-tracking-harness) against this checkout's plugins.
# From the repository root: tooling/error-tracking-harness/run-ci.sh <absolute artifact directory> [--fixtures names] [harness args...]
#
# HARNESS_IMAGE must be the digest-pinned image: a tag could change under CI, a digest cannot.
# The harness runs with no network; plugin overrides come from the packed tarballs.
set -euo pipefail
artifacts=${1:?absolute artifact directory required}
shift
[[ "$artifacts" = /* ]] || { echo 'Absolute artifact directory required' >&2; exit 2; }
mkdir -p "$artifacts"

# Override only plugins used by the selected fixtures: the harness rejects unused overrides.
fixtures='next-14,next-15,next-16-turbopack,next-16-webpack,nuxt-4,rollup-4,vite-8,vite-8-sri,webpack-5.112,webpack-5.112-sri'
args=()
while (( $# )); do
    case "$1" in
        --fixtures)
            [[ $# -ge 2 ]] || { echo '--fixtures needs a value' >&2; exit 2; }
            fixtures=$2; shift 2 ;;
        --fixtures=*) fixtures=${1#*=}; shift ;;
        --tags|--tags=*) echo 'Use --fixtures with local plugin overrides, not --tags.' >&2; exit 2 ;;
        *) args+=("$1"); shift ;;
    esac
done
IFS=, read -r -a names <<< "$fixtures"
(( ${#names[@]} > 0 )) || { echo 'Empty fixture selection' >&2; exit 2; }
plugins=()
for fixture in "${names[@]}"; do
    case "$fixture" in
        next-14|next-15|next-16-turbopack|next-16-webpack) plugin=@posthog/nextjs-config ;;
        nuxt-4) plugin=@posthog/nuxt ;;
        rollup-4|vite-8|vite-8-sri) plugin=@posthog/rollup-plugin ;;
        webpack-5.112|webpack-5.112-sri) plugin=@posthog/webpack-plugin ;;
        *) echo "Unsupported fixture for local overrides: $fixture" >&2; exit 2 ;;
    esac
    if [[ ! " ${plugins[*]} " == *" $plugin "* ]]; then plugins+=("$plugin"); fi
done
# Nuxt and webpack depend on core, which in turn depends on types. Bind both
# transitive packages offline instead of using older versions baked into fixtures.
overrides=("${plugins[@]}")
if [[ " ${plugins[*]} " == *' @posthog/nuxt '* || " ${plugins[*]} " == *' @posthog/webpack-plugin '* ]]; then
    overrides+=(@posthog/core @posthog/types)
fi
filters=()
for package in "${overrides[@]}"; do filters+=("--filter=$package"); done

if [[ ! "${HARNESS_IMAGE:-}" =~ ^ghcr\.io/posthog/error-tracking-harness@sha256:[0-9a-f]{64}$ ]]; then
    echo 'HARNESS_IMAGE must be ghcr.io/posthog/error-tracking-harness@sha256:<64 lowercase hex digits>.' >&2
    exit 2
fi
printf 'HARNESS_IMAGE=%s\n' "$HARNESS_IMAGE" > "$artifacts/image.txt"
git rev-parse HEAD > "$artifacts/source.txt"

# Pack the selected plugins and overrides, plus the SDKs used by the fixtures.
export PACKAGE_DEST="$PWD/target"
rm -rf "$PACKAGE_DEST"
pnpm turbo run package "${filters[@]}" --filter=posthog-node --filter=posthog-js
ls "$PACKAGE_DEST" > "$artifacts/subject.txt"

# The new harness accepts named local tarballs, not --plugins subject. Locate tarballs by
# package identity rather than relying on pnpm's archive filename convention. Other packed
# workspace packages are build dependencies; bind core and types with Nuxt/webpack.
node - "$PACKAGE_DEST" "${overrides[@]}" <<'NODE'
const { execFileSync } = require('node:child_process')
const { readdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const directory = process.argv[2]
const expected = new Set(process.argv.slice(3))
const packages = {}
for (const file of readdirSync(directory).filter((name) => name.endsWith('.tgz'))) {
    const manifest = JSON.parse(execFileSync('tar', ['-xzOf', path.join(directory, file), 'package/package.json'], { encoding: 'utf8' }))
    if (!expected.has(manifest.name)) continue
    if (packages[manifest.name]) throw new Error(`Duplicate tarball for ${manifest.name}`)
    packages[manifest.name] = `/subject/${file}`
}
const missing = [...expected].filter((name) => !packages[name])
if (missing.length) throw new Error(`Missing override tarballs: ${missing.join(', ')}`)
writeFileSync(path.join(directory, 'overrides.json'), JSON.stringify({ packages }, null, 2) + '\n')
NODE

# pnpm-isolated cannot bind local overrides; select only supported plugin fixtures.
docker pull "$HARNESS_IMAGE"
docker run --rm --network none \
    -v "$PACKAGE_DEST:/subject:ro" -v "$artifacts:/artifacts" \
    "$HARNESS_IMAGE" --artifacts /artifacts --overrides /subject/overrides.json --fixtures "$fixtures" "${args[@]}"
