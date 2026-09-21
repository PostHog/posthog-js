import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const script = new URL('./prepare-ci.sh', import.meta.url).pathname
// Synthetic identities are used only with the Docker stand-in, never pulled.
const digest = 'a'.repeat(64)
const nodeImage = `node:24-bookworm-slim@sha256:${digest}`
const harnessImage = `ghcr.io/posthog/sdk-test-harness-v2@sha256:${digest}`
for (const [scenario, node, harness, exit, message] of [
    ['success', nodeImage, harnessImage, 0],
    ['qualified-node', `docker.io/library/node@sha256:${digest}`, harnessImage, 0],
    ['unset-node', '', harnessImage, 2, 'SDK_COMPLIANCE_NODE_IMAGE'],
    ['unset-harness', nodeImage, '', 2, 'SDK_COMPLIANCE_V2_HARNESS_IMAGE'],
    ['mutable-node', 'node:24-bookworm-slim', harnessImage, 2, 'SDK_COMPLIANCE_NODE_IMAGE'],
    ['missing-repository', `@sha256:${digest}`, harnessImage, 2, 'SDK_COMPLIANCE_NODE_IMAGE'],
    ['invalid-repository', `https://node@sha256:${digest}`, harnessImage, 2, 'SDK_COMPLIANCE_NODE_IMAGE'],
    ['short-digest', 'node@sha256:abc', harnessImage, 2, 'SDK_COMPLIANCE_NODE_IMAGE'],
    ['mutable-harness', nodeImage, 'ghcr.io/posthog/sdk-test-harness-v2:latest', 2, 'SDK_COMPLIANCE_V2_HARNESS_IMAGE'],
    ['wrong-harness', nodeImage, `ghcr.io/other/harness@sha256:${digest}`, 2, 'SDK_COMPLIANCE_V2_HARNESS_IMAGE'],
    ['pull-failed', nodeImage, harnessImage, 17],
    ['build-failed', nodeImage, harnessImage, 18],
    ['identity-failed', nodeImage, harnessImage, 19],
]) {
    test(`CI preparation: ${scenario}`, (t) => {
        const root = mkdtempSync(join(tmpdir(), 'node-ci-test-'))
        t.after(() => rmSync(root, { recursive: true, force: true }))
        const bin = join(root, 'bin')
        const artifacts = join(root, 'artifacts')
        mkdirSync(bin)
        mkdirSync(artifacts)
        writeFileSync(join(bin, 'git'), '#!/usr/bin/env bash\n[[ "$1" != rev-parse ]] || echo selected-head\n', {
            mode: 0o755,
        })
        writeFileSync(
            join(bin, 'docker'),
            `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$CI_TEST_ROOT/commands"
echo "docker $1 diagnostic" >&2
case "$1:$CI_TEST_SCENARIO" in
    pull:pull-failed) exit 17 ;;
    build:build-failed) exit 18 ;;
    run:identity-failed) exit 19 ;;
esac
if [[ "$1" = run ]]; then echo '{"source_revision":"selected-head"}'; fi
`,
            { mode: 0o755 }
        )
        // Match the workflow's bash pipefail + tee, including on failed builds.
        const result = spawnSync(
            'bash',
            ['-eo', 'pipefail', '-c', 'bash "$1" "$2" 2>&1 | tee "$2/prepare.log"', '--', script, artifacts],
            {
                env: {
                    ...process.env,
                    PATH: `${bin}:${process.env.PATH}`,
                    NODE_IMAGE: node,
                    HARNESS_IMAGE: harness,
                    CI_TEST_ROOT: root,
                    CI_TEST_SCENARIO: scenario,
                },
                encoding: 'utf8',
                timeout: 10000,
            }
        )
        assert.equal(result.status, exit, result.stderr)
        assert.equal(readFileSync(join(artifacts, 'prepare-exit.txt'), 'utf8').trim(), String(exit))
        assert.equal(readFileSync(join(artifacts, 'source.txt'), 'utf8').trim(), 'selected-head')
        const log = readFileSync(join(artifacts, 'prepare.log'), 'utf8')
        if (message) {
            assert.ok(log.includes(message))
            assert.ok(!log.includes('docker '))
        } else {
            assert.ok(log.includes('docker pull diagnostic'))
            const commands = readFileSync(join(root, 'commands'), 'utf8')
            assert.ok(commands.includes(`pull ${harnessImage}`))
            if (scenario !== 'pull-failed') {
                assert.ok(commands.includes('--build-arg SOURCE_REVISION=selected-head'))
                assert.ok(commands.includes(`--build-arg NODE_IMAGE=${node}`))
                assert.ok(commands.includes('--file compliance/node/v2/Dockerfile'))
            }
            if (exit === 0) {
                assert.ok(
                    commands.includes('run --rm --network none --entrypoint cat node-compliance:local /build.json')
                )
                assert.equal(JSON.parse(readFileSync(join(artifacts, 'build.json'))).source_revision, 'selected-head')
            }
        }
    })
}
