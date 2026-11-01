#!/usr/bin/env bash
# Smoke test the fixed PR tarball artifact without Docker or registry access.
set -euo pipefail
packer=$(cd "$(dirname "$0")" && pwd)/pack.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
git -C "$work" init -q
GIT_CONFIG_GLOBAL=/dev/null git -C "$work" -c user.name=Test -c user.email=test@example.com commit -q --allow-empty -m base

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
            printf '{"name":"%s","version":"1.0.0"}\n' "$name" > "$TEST_WORK/package/package/package.json"
            tar -czf "$PACKAGE_DEST/$file.tgz" -C "$TEST_WORK/package" package
            ;;
    esac
done
printf '{"name":"@posthog/unselected","version":"1.0.0"}\n' > "$TEST_WORK/package/package/package.json"
tar -czf "$PACKAGE_DEST/unselected.tgz" -C "$TEST_WORK/package" package
SH
cat > "$work/bin/npm" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$TEST_WORK/npm.txt"
printf '{"name":"@posthog/cli","version":"0.18.11"}\n' > "$TEST_WORK/package/package/package.json"
tar -czf "$PACKAGE_DEST/posthog-cli-0.18.11.tgz" -C "$TEST_WORK/package" package
SH
chmod +x "$work/bin/"*
export TEST_WORK=$work PATH="$work/bin:$PATH"
cd "$work"
printf "catalog:\n  '@posthog/cli': ~0.18.11\n" > pnpm-workspace.yaml
"$packer" "$work/subject"
node - "$work/subject/overrides.json" <<'NODE'
const p = require(process.argv[2]).packages
const expected = ['@posthog/browser-common', '@posthog/cli', '@posthog/core', '@posthog/nextjs-config',
  '@posthog/nuxt', '@posthog/plugin-utils', '@posthog/rollup-plugin', '@posthog/types',
  '@posthog/webpack-plugin', 'posthog-js', 'posthog-node']
if (JSON.stringify(Object.keys(p).sort()) !== JSON.stringify(expected.sort())) process.exit(1)
for (const target of Object.values(p)) {
  if (!target.startsWith('/subject/') || !require('node:fs').existsSync(`.${target}`)) process.exit(1)
}
NODE
test "$(< "$work/subject/source.txt")" = "$(git rev-parse HEAD)"
grep -q -- '--filter=@posthog/nextjs-config' filters.txt
grep -q -- '--filter=@posthog/nuxt' filters.txt
grep -q -- '@posthog/cli@0.18.11' npm.txt
if [[ -e subject/unselected.tgz ]] || grep -q -- '--filter=@posthog/cli' filters.txt; then exit 1; fi
if "$packer" relative-output > "$work/rejected.txt" 2>&1; then exit 1; fi
echo 'Fixed subject packaging checks passed.'
