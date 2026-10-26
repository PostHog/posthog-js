#!/usr/bin/env bash
# Run the error tracking harness (PostHog/error-tracking-harness) against this checkout's plugins.
# From the repository root: tooling/error-tracking-harness/run-ci.sh <absolute artifact directory> [harness args...]
#
# HARNESS_IMAGE must be the digest-pinned image: a tag could change under CI, a digest cannot.
# The harness runs with no network; plugin overrides come from the packed tarballs.
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

# The new harness accepts named local tarballs, not --plugins subject. Locate tarballs by
# package identity rather than relying on pnpm's archive filename convention. Other packed
# workspace packages are build dependencies; fixture bindings currently override the plugins.
node - "$PACKAGE_DEST" <<'NODE'
const { execFileSync } = require('node:child_process')
const { readdirSync, writeFileSync } = require('node:fs')
const path = require('node:path')
const directory = process.argv[2]
const expected = new Set(['@posthog/webpack-plugin', '@posthog/rollup-plugin', '@posthog/nextjs-config', '@posthog/nuxt'])
const packages = {}
for (const file of readdirSync(directory).filter((name) => name.endsWith('.tgz'))) {
    const manifest = JSON.parse(execFileSync('tar', ['-xzOf', path.join(directory, file), 'package/package.json'], { encoding: 'utf8' }))
    if (!expected.has(manifest.name)) continue
    if (packages[manifest.name]) throw new Error(`Duplicate tarball for ${manifest.name}`)
    packages[manifest.name] = `/subject/${file}`
}
const missing = [...expected].filter((name) => !packages[name])
if (missing.length) throw new Error(`Missing plugin tarballs: ${missing.join(', ')}`)
writeFileSync(path.join(directory, 'overrides.json'), JSON.stringify({ packages }, null, 2) + '\n')
NODE

# pnpm-isolated cannot bind local overrides; exercise every supported plugin fixture instead.
selection=(--fixtures 'next-14,next-15,next-16-turbopack,next-16-webpack,nuxt-4,rollup-4,vite-8,vite-8-sri,webpack-5.112,webpack-5.112-sri')
for arg in "$@"; do
    case "$arg" in --fixtures|--fixtures=*|--tags|--tags=*) selection=(); break ;; esac
done

docker pull "$HARNESS_IMAGE"
docker run --rm --network none \
    -v "$PACKAGE_DEST:/subject:ro" -v "$artifacts:/artifacts" \
    "$HARNESS_IMAGE" --artifacts /artifacts --overrides /subject/overrides.json "${selection[@]}" "$@"
