#!/usr/bin/env bash
# Offline smoke test for fixture-specific tarballs, overrides and Docker selection.
set -euo pipefail
runner=$(cd "$(dirname "$0")" && pwd)/run-ci.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/artifacts"
git -C "$work" init -q
git -C "$work" -c user.name=Test -c user.email=test@example.com commit -q --allow-empty -m base
cat > "$work/bin/pnpm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$TEST_WORK/filters.txt"
mkdir -p "$PACKAGE_DEST" "$TEST_WORK/package/package"
for arg in "$@"; do
    case "$arg" in
        --filter=@posthog/*|--filter=posthog-node)
            if [[ "$arg" == --filter=posthog-node ]]; then names=(core types); else names=("${arg#--filter=@posthog/}"); fi
            for name in "${names[@]}"; do
                printf '{"name":"@posthog/%s"}\n' "$name" > "$TEST_WORK/package/package/package.json"
                tar -czf "$PACKAGE_DEST/$name.tgz" -C "$TEST_WORK/package" package
            done
            ;;
    esac
done
SH
cat > "$work/bin/docker" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_WORK/docker.txt"
SH
chmod +x "$work/bin/"*
export TEST_WORK=$work PATH="$work/bin:$PATH"
HARNESS_IMAGE="ghcr.io/posthog/error-tracking-harness@sha256:$(printf 'a%.0s' {1..64})"
export HARNESS_IMAGE
cd "$work"
"$runner" "$work/artifacts" --fixtures 'rollup-4,vite-8-sri' --list
node -e 'const p=require("./target/overrides.json").packages; if (Object.keys(p).join()!=="@posthog/rollup-plugin") process.exit(1)'
grep -q -- '--filter=@posthog/rollup-plugin' filters.txt
if grep -q -- '--filter=@posthog/webpack-plugin' filters.txt; then exit 1; fi
grep -q -- '--fixtures rollup-4,vite-8-sri --list' docker.txt

"$runner" "$work/artifacts" --fixtures 'next-14,webpack-5.112'
node -e 'const p=require("./target/overrides.json").packages; if (Object.keys(p).sort().join()!=="@posthog/core,@posthog/nextjs-config,@posthog/types,@posthog/webpack-plugin") process.exit(1)'
grep -q -- '--filter=@posthog/nextjs-config' filters.txt
grep -q -- '--filter=@posthog/webpack-plugin' filters.txt

"$runner" "$work/artifacts" --fixtures 'nuxt-4'
node -e 'const p=require("./target/overrides.json").packages; if (Object.keys(p).sort().join()!=="@posthog/core,@posthog/nuxt,@posthog/types") process.exit(1)'
echo 'Harness override checks passed.'
