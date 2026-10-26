#!/usr/bin/env bash
set -euo pipefail
selector=$(cd "$(dirname "$0")" && pwd)/select-fixtures.sh
repo=$(mktemp -d)
trap 'rm -rf "$repo"' EXIT
cd "$repo"
git init -q
git -c user.name=Test -c user.email=test@example.com commit -q --allow-empty -m base
base=$(git rev-parse HEAD)
all=$($selector --all)

check() {
    local expected=$1
    shift
    git reset -q --hard "$base"
    git clean -q -fd
    for path in "$@"; do
        mkdir -p "$(dirname "$path")"
        echo changed > "$path"
    done
    git add -A
    git -c user.name=Test -c user.email=test@example.com commit -q --allow-empty -m change
    local actual
    actual=$($selector "$base" HEAD)
    [[ "$actual" == "$expected" ]] || { echo "Expected $expected, got $actual ($*)" >&2; exit 1; }
}

check 'next-14,next-15,next-16-turbopack,next-16-webpack' packages/nextjs-config/src/plugin.ts
check 'nuxt-4' packages/nuxt/src/module.ts
check 'rollup-4,vite-8,vite-8-sri' packages/rollup-plugin/src/index.ts
check 'next-14,next-15,next-16-turbopack,next-16-webpack,webpack-5.112,webpack-5.112-sri' packages/webpack-plugin/src/index.ts
check 'next-14,next-15,next-16-turbopack,next-16-webpack,rollup-4,vite-8,vite-8-sri,webpack-5.112,webpack-5.112-sri' packages/rollup-plugin/src/index.ts packages/webpack-plugin/src/index.ts
check "$all" packages/rollup-plugin/src/index.ts packages/plugin-utils/src/index.ts
check "$all" packages/core/src/error-tracking/index.ts
check "$all" .github/workflows/error-tracking-harness.yml
check "$all"
[[ $($selector 0000000000000000000000000000000000000000 HEAD) == "$all" ]]
[[ $($selector missing HEAD) == "$all" ]]
echo 'Fixture selection checks passed.'
