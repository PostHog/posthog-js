#!/usr/bin/env bash
# Smoke test for fixture-specific tarballs, minimal Docker context and offline run.
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
        --filter=*)
            name=${arg#--filter=}
            file=${name#@posthog/}
            printf '{"name":"%s"}\n' "$name" > "$TEST_WORK/package/package/package.json"
            tar -czf "$PACKAGE_DEST/$file.tgz" -C "$TEST_WORK/package" package
            ;;
    esac
done
# Turbo can pack dependencies not needed by the selected fixtures; don't put them in Docker context.
printf '{"name":"@posthog/unselected"}\n' > "$TEST_WORK/package/package/package.json"
tar -czf "$PACKAGE_DEST/unselected.tgz" -C "$TEST_WORK/package" package
SH
cat > "$work/bin/npm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$TEST_WORK/npm.txt"
mkdir -p "$TEST_WORK/package/package"
printf '{"name":"@posthog/cli","version":"0.18.11"}\n' > "$TEST_WORK/package/package/package.json"
tar -czf "$PACKAGE_DEST/posthog-cli-0.18.11.tgz" -C "$TEST_WORK/package" package
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
printf "catalog:\n  '@posthog/cli': ~0.18.11\n" > pnpm-workspace.yaml
"$runner" "$work/artifacts" --fixtures 'rollup-4,vite-8-sri' --list
node -e 'const p=require("./artifacts/subject-context/overrides.json").packages; if (Object.keys(p).sort().join()!=="@posthog/browser-common,@posthog/cli,@posthog/core,@posthog/plugin-utils,@posthog/rollup-plugin,@posthog/types,posthog-js,posthog-node") process.exit(1)'
grep -q -- '--filter=@posthog/rollup-plugin' filters.txt
grep -q -- '@posthog/cli@0.18.11' npm.txt
if [[ -e artifacts/subject-context/unselected.tgz ]]; then exit 1; fi
if grep -q -- '--filter=@posthog/cli' filters.txt; then exit 1; fi
if grep -q -- '--filter=@posthog/webpack-plugin' filters.txt; then exit 1; fi
grep -q -- 'build -f tooling/error-tracking-harness/Dockerfile.subject' docker.txt
grep -q -- '--network none' docker.txt
grep -q -- '--fixtures rollup-4,vite-8-sri --list' docker.txt

"$runner" "$work/artifacts" --fixtures 'vite-8-autocapture'
node -e 'const p=require("./artifacts/subject-context/overrides.json").packages; if (Object.keys(p).sort().join()!=="@posthog/browser-common,@posthog/cli,@posthog/core,@posthog/plugin-utils,@posthog/rollup-plugin,@posthog/types,posthog-js") process.exit(1)'

"$runner" "$work/artifacts" --fixtures 'next-14,webpack-5.112'
node -e 'const p=require("./artifacts/subject-context/overrides.json").packages; if (Object.keys(p).sort().join()!=="@posthog/browser-common,@posthog/cli,@posthog/core,@posthog/nextjs-config,@posthog/plugin-utils,@posthog/types,@posthog/webpack-plugin,posthog-js,posthog-node") process.exit(1)'
grep -q -- '--filter=@posthog/nextjs-config' filters.txt
grep -q -- '--filter=@posthog/webpack-plugin' filters.txt

"$runner" "$work/artifacts" --fixtures 'next-15'
node -e 'const p=require("./artifacts/subject-context/overrides.json").packages; if (Object.keys(p).sort().join()!=="@posthog/browser-common,@posthog/cli,@posthog/core,@posthog/nextjs-config,@posthog/plugin-utils,@posthog/types,@posthog/webpack-plugin,posthog-js,posthog-node") process.exit(1)'

"$runner" "$work/artifacts" --fixtures 'nuxt-4'
node -e 'const p=require("./artifacts/subject-context/overrides.json").packages; if (Object.keys(p).sort().join()!=="@posthog/browser-common,@posthog/cli,@posthog/core,@posthog/nuxt,@posthog/plugin-utils,@posthog/types,posthog-js,posthog-node") process.exit(1)'
echo 'Prepared subject image checks passed.'
