#!/usr/bin/env bash
# Produce PR-built package tarballs for the reusable error-tracking smoke workflow.
set -euo pipefail
subject=${1:?absolute output directory required}
[[ "$subject" = /* && "$subject" != / ]] || { echo 'Absolute non-root output directory required' >&2; exit 2; }
mkdir -p "$subject"
[[ -z $(find "$subject" -mindepth 1 -maxdepth 1 -print -quit) ]] || { echo 'Output directory must be empty' >&2; exit 2; }

# Fixed smoke suite: Rollup, Vite autocapture, webpack, Next 14/15 and Nuxt.
# Pack the direct plugins and their complete workspace dependency closure so
# consumers cannot silently resolve published versions of transitive packages.
packages=(
    @posthog/rollup-plugin @posthog/webpack-plugin @posthog/nextjs-config @posthog/nuxt
    @posthog/plugin-utils posthog-node posthog-js @posthog/browser-common @posthog/core @posthog/types
    @posthog/cli
)
filters=()
for package in "${packages[@]}"; do
    [[ "$package" == @posthog/cli ]] || filters+=("--filter=$package")
done

export PACKAGE_DEST="$PWD/target"
rm -rf "$PACKAGE_DEST"
pnpm turbo run package "${filters[@]}"
# The npm CLI shim is a plugin dependency, not the selected harness CLI binary.
# Its catalog version is fixed; packaging it must not execute its postinstall.
cli_version=$(node <<'NODE'
const { readFileSync } = require('node:fs')
const match = readFileSync('pnpm-workspace.yaml', 'utf8').match(/^\s*['"]@posthog\/cli['"]:\s*~(\d+\.\d+\.\d+)\s*$/m)
if (!match) throw new Error('Expected a tilde-pinned @posthog/cli catalog version')
process.stdout.write(match[1])
NODE
)
npm --prefix "$subject" pack "@posthog/cli@$cli_version" --pack-destination "$PACKAGE_DEST" --ignore-scripts --silent

# Stage only the expected tarballs; the Docker build context contains no source or secrets.
node - "$PACKAGE_DEST" "$subject" "${packages[@]}" <<'NODE'
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
if (missing.length) throw new Error(`Missing tarballs: ${missing.join(', ')}`)
writeFileSync(path.join(context, 'overrides.json'), JSON.stringify({ packages }, null, 2) + '\n')
NODE
git rev-parse HEAD > "$subject/source.txt"
