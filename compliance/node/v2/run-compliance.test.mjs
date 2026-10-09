import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = new URL('./run-compliance.sh', import.meta.url).pathname
for (const [scenario, exit, mode = 'v0', suite] of [
    ['success', 0],
    ['success', 0, 'v1'],
    ['success', 0, 'v0', 'acceptance'],
    ['success', 0, 'v1', 'acceptance'],
    ['cli-failed', 7, 'v1', 'acceptance'],
    ['cli-and-cleanup-failed', 7],
    ['cli-failed', 7],
    ['missing-report', 1],
    ['bad-report', 1],
    ['empty-report', 1],
    ['failed-report', 1],
    ['missing-diagnostics', 1],
    ['mismatched-diagnostics', 1],
    ['startup-failed', 1],
    ['cleanup-failed', 1],
    ['run-hung', 124],
    ['startup-hung', 1],
    ['cleanup-hung', 1],
]) {
    test(`compliance caller (${mode}, ${suite || 'migration'}): ${scenario}`, (t) => {
        const root = mkdtempSync(join(tmpdir(), 'node-caller-test-'))
        t.after(() => rmSync(root, { recursive: true, force: true }))
        const bin = join(root, 'bin')
        mkdirSync(bin)
        writeFileSync(
            join(bin, 'docker'),
            `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$CALLER_TEST_ROOT/commands"
case "$1" in
    exec)
        [[ "$CALLER_TEST_SCENARIO" != startup-hung ]] || /bin/sleep 30
        [[ "$CALLER_TEST_SCENARIO" != startup-failed ]] || exit 1 ;;
    start)
        if [[ "\${2:-}" = --attach && "$3" = *-check ]]; then
            # The generic harness owns artifact validation; its real negative controls
            # are in harness tests. This stand-in checks caller exit propagation.
            case "$CALLER_TEST_SCENARIO" in
                missing-report|bad-report|empty-report|failed-report|missing-diagnostics|mismatched-diagnostics) exit 1 ;;
            esac
        elif [[ "\${2:-}" = --attach ]]; then
            [[ "$CALLER_TEST_SCENARIO" != run-hung ]] || /bin/sleep 30
            case "$CALLER_TEST_SCENARIO" in
                missing-report) ;;
                bad-report) echo 'bad' > "$CALLER_TEST_ROOT/reports/report.json" ;;
                empty-report) echo '{}' > "$CALLER_TEST_ROOT/reports/report.json" ;;
                *) echo '{"run_id":"test-run"}' > "$CALLER_TEST_ROOT/reports/report.json" ;;
            esac
            [[ "$CALLER_TEST_SCENARIO" != cli-failed && "$CALLER_TEST_SCENARIO" != cli-and-cleanup-failed ]] || exit 7
        fi ;;
    network)
        if [[ "$2" = rm ]]; then
            [[ "$CALLER_TEST_SCENARIO" != cleanup-hung ]] || /bin/sleep 30
            [[ "$CALLER_TEST_SCENARIO" != cleanup-failed && "$CALLER_TEST_SCENARIO" != cli-and-cleanup-failed ]] || exit 1
        fi ;;
esac
`,
            { mode: 0o755 }
        )
        writeFileSync(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 })
        const started = Date.now()
        const result = spawnSync(
            'bash',
            [script, 'adapter:test', 'harness:test', mode, join(root, 'reports'), ...(suite ? [suite] : [])],
            {
                env: {
                    ...process.env,
                    PATH: `${bin}:${process.env.PATH}`,
                    CALLER_TEST_ROOT: root,
                    CALLER_TEST_SCENARIO: scenario,
                    SDK_COMPLIANCE_COMMAND_TIMEOUT_MS: '500',
                    SDK_COMPLIANCE_STARTUP_TIMEOUT_MS: '100',
                    SDK_COMPLIANCE_RUN_TIMEOUT_MS: '200',
                },
                encoding: 'utf8',
                timeout: 20000,
            }
        )
        assert.equal(result.status, exit, result.stderr)
        assert.ok(Date.now() - started < 20000)
        const commands = readFileSync(join(root, 'commands'), 'utf8')
        assert.ok(commands.includes('network create --internal'))
        assert.ok(!commands.includes('--publish'))
        assert.ok(commands.includes('network rm'))
        if (!scenario.startsWith('startup-')) {
            const profile = mode === 'v0' ? 'node-legacy' : 'node-analytics-v1'
            assert.ok(commands.includes(`check-report --report /reports/report.json --profile ${profile}`))
            assert.ok(commands.includes(`run --${suite || 'migration'}-suite --adapter-url`))
            assert.ok(commands.includes(`--profile ${profile} --timeout-ms`))
            assert.ok(commands.includes(`POSTHOG_CAPTURE_MODE=${mode}`))
            assert.ok(commands.includes('--network none'))
            assert.equal(
                readFileSync(join(root, 'reports/cli-exit.txt'), 'utf8').trim(),
                scenario.startsWith('cli-') ? '7' : scenario === 'run-hung' ? '124' : '0'
            )
        }
        if (scenario.endsWith('-hung')) {
            const log =
                scenario === 'run-hung'
                    ? 'cli.log'
                    : scenario === 'startup-hung'
                      ? 'startup.log'
                      : 'network-cleanup.log'
            assert.match(readFileSync(join(root, 'reports', log), 'utf8'), /Command deadline exceeded/)
        }
    })
}
