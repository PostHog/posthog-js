#!/usr/bin/env bash
# Print the fixtures affected by a diff. Unknown/shared paths fail open to the full matrix.
set -euo pipefail
all='next-14,next-15,next-16-turbopack,next-16-webpack,nuxt-4,rollup-4,vite-8,vite-8-sri,webpack-5.112,webpack-5.112-sri'

if [[ ${1:-} == --all ]]; then
    echo "$all"
    exit 0
fi
base=${1:?base commit required}
head=${2:-HEAD}
if [[ "$base" =~ ^0+$ ]] || ! git rev-parse --verify "${base}^{commit}" >/dev/null 2>&1 ||
    ! git rev-parse --verify "${head}^{commit}" >/dev/null 2>&1; then
    echo "$all"
    exit 0
fi

if ! changes=$(git diff --no-renames --name-only "$base" "$head"); then
    echo "$all"
    exit 0
fi
next=false nuxt=false rollup=false webpack=false shared=false
while IFS= read -r path; do
    case "$path" in
        packages/nextjs-config/*) next=true ;;
        packages/nuxt/*) nuxt=true ;;
        packages/rollup-plugin/*) rollup=true ;;
        # nextjs-config consumes the webpack plugin, so run its fixtures as well.
        packages/webpack-plugin/*) webpack=true; next=true ;;
        *) shared=true ;;
    esac
done <<< "$changes"

if [[ "$shared" == true ]] || [[ "$next" == false && "$nuxt" == false && "$rollup" == false && "$webpack" == false ]]; then
    echo "$all"
    exit 0
fi
fixtures=()
if [[ "$next" == true ]]; then fixtures+=(next-14 next-15 next-16-turbopack next-16-webpack); fi
if [[ "$nuxt" == true ]]; then fixtures+=(nuxt-4); fi
if [[ "$rollup" == true ]]; then fixtures+=(rollup-4 vite-8 vite-8-sri); fi
if [[ "$webpack" == true ]]; then fixtures+=(webpack-5.112 webpack-5.112-sri); fi
(IFS=,; echo "${fixtures[*]}")
