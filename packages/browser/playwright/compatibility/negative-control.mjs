/* eslint-disable no-console -- Standalone browser test fixtures exercise public APIs without importing SDK runtime helpers. */
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseOptions } from './options.mjs'
import { capturedReplayRequests, replayNetworkCases, replayNetworkPath } from './replay-network.mjs'
import { prepare, inputInventory, directory, repository, execute, inventoryTree } from './prepare.mjs'

const args = parseOptions(process.argv.slice(2), ['output'])
const folder = resolve(
    args.output ??
        join(repository, 'test-results/compatibility', `controls-${new Date().toISOString().replace(/[:.]/g, '-')}`)
)
mkdirSync(dirname(folder), { recursive: true })
mkdirSync(folder, { recursive: false })
console.log(
    execute('pnpm', ['turbo', 'run', 'build', '--filter=posthog-js', '--filter=@posthog-tooling/sdk-mock-server'])
)
const egress = spawnSync(process.execPath, ['--test', join(directory, 'egress.browser-test.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, COMPATIBILITY_EGRESS_EVIDENCE: join(folder, 'egress.json') },
})
assert.equal(egress.status, 0, 'Browser egress control failed')
const manifest = await prepare(join(folder, 'artifacts'))
const compression = spawnSync(process.execPath, ['--test', join(directory, 'replay-compression.browser-test.mjs')], {
    stdio: 'inherit',
    env: { ...process.env, COMPATIBILITY_COMPRESSION_MANIFEST: join(folder, 'artifacts/manifest.json') },
})
assert.equal(compression.status, 0, 'Delayed native replay compression changed snapshots')
const core = manifest.sources.candidate
const dist = join(folder, 'cdn')
cpSync(core.dist, dist, { recursive: true })
core.dist = dist
manifest.inputIntegrity = inputInventory(manifest)
const marker = 'compatibility CDN fault canary'
writeFileSync(join(dist, 'surveys.js'), `throw new Error(${JSON.stringify(marker)});\n`)
const manifestPath = join(folder, 'manifest.json')
const target = join(directory, 'goldens')
const goldenInventory = () => (existsSync(target) ? inventoryTree(target, 'goldens') : null)
const before = goldenInventory()
const run = (name, operation, { modes = 'npm', comparisons = 'current,historical', scenarios = 'surveys' } = {}) => {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    const result = spawnSync(
        process.execPath,
        [
            join(directory, 'run.mjs'),
            '--manifest',
            manifestPath,
            '--engines',
            'chromium',
            '--modes',
            modes,
            '--comparisons',
            comparisons,
            '--scenarios',
            scenarios,
            '--repeats',
            '2',
            '--operation',
            operation,
            '--output',
            join(folder, name),
        ],
        { encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 }
    )
    writeFileSync(join(folder, `${name}.log`), (result.stdout ?? '') + (result.stderr ?? ''))
    if (result.error) throw result.error
    assert.equal(result.status, 1)
    assert.deepEqual(goldenInventory(), before, 'Fault control changed expected snapshots')
    return result
}
const integrity = run('integrity-canary', 'update')
assert.match(integrity.stderr, /Input changed: artifacts\/candidate\/cdn\/surveys\.js/)
assert(!existsSync(join(folder, 'integrity-canary/progress.json')), 'Corrupt artifact reached browser execution')
manifest.inputIntegrity = inputInventory(manifest)
run('cdn-canary', 'update')
const report = JSON.parse(readFileSync(join(folder, 'cdn-canary/report.json')))
assert.equal(report.completedRuns, 4)
assert.equal(report.passed, false)
for (const cell of report.results) {
    assert.equal(cell.status, 'failed')
    for (const run of cell.runs) {
        assert.equal(run.status, 'failed')
        const failure = JSON.parse(readFileSync(join(run.folder, 'failure.json')))
        assert(failure.state.pageErrors.some((error) => error.message === marker))
        assert(
            failure.state.network.requests.some(
                (request) => request.path === '/static/surveys.js' && request.status === 200
            )
        )
    }
}
const logFixture = core.fixtures.npm.path
writeFileSync(
    logFixture,
    readFileSync(logFixture, 'utf8') + '\ndelete Object.getPrototypeOf(window.__compat.ph).captureLog;\n'
)
manifest.inputIntegrity = inputInventory(manifest)
run('logs-canary', 'update', { comparisons: 'current', scenarios: 'logs' })
const logReport = JSON.parse(readFileSync(join(folder, 'logs-canary/report.json')))
assert.equal(logReport.completedRuns, 2)
assert.equal(logReport.passed, false)
for (const cell of logReport.results) {
    assert.equal(cell.status, 'failed')
    for (const run of cell.runs) {
        assert.equal(run.status, 'failed')
        const failure = JSON.parse(readFileSync(join(run.folder, 'failure.json')))
        assert.match(failure.message, /Current core is missing captureLog/)
        assert(
            failure.state.api.observations.some(
                (observation) => observation.method === 'captureLog' && observation.returned?.$kind === 'missing-method'
            )
        )
    }
}
writeFileSync(join(dist, 'web-vitals.js'), '/* Deliberately empty metric extension. */\n')
manifest.inputIntegrity = inputInventory(manifest)
run('web-vitals-canary', 'update', { scenarios: 'web-vitals' })
const vitalsReport = JSON.parse(readFileSync(join(folder, 'web-vitals-canary/report.json')))
assert.equal(vitalsReport.completedRuns, 4)
assert.equal(vitalsReport.passed, false)
for (const cell of vitalsReport.results) {
    assert.equal(cell.status, 'failed')
    for (const run of cell.runs) {
        assert.equal(run.status, 'failed')
        const failure = JSON.parse(readFileSync(join(run.folder, 'failure.json')))
        assert(
            failure.state.network.requests.some(
                (request) => request.path === '/static/web-vitals.js' && request.status === 200
            )
        )
        assert(!failure.state.network.events.some((event) => event.event === '$web_vitals'))
    }
}
for (const source of Object.values(manifest.sources)) {
    const fixture = source.fixtures.npm?.path
    if (!fixture) continue
    writeFileSync(
        fixture,
        readFileSync(fixture, 'utf8') +
            `\nconst replayOptions = window.__compat.options;
window.__compat.options = () => {
    const options = replayOptions();
    return { ...options, session_recording: { ...options.session_recording, recordHeaders: false, recordBody: false } };
};\n`
    )
}
manifest.inputIntegrity = inputInventory(manifest)
run('replay-network-canary', 'update', { scenarios: 'replay' })
const networkReport = JSON.parse(readFileSync(join(folder, 'replay-network-canary/report.json')))
assert.equal(networkReport.completedRuns, 4)
assert.equal(networkReport.passed, false)
for (const cell of networkReport.results) {
    assert.equal(cell.status, 'failed')
    for (const run of cell.runs) {
        const failure = JSON.parse(readFileSync(join(run.folder, 'failure.json')))
        assert.match(failure.stack, /exerciseReplayNetwork/)
        for (const sample of replayNetworkCases) {
            const path = `${replayNetworkPath}/${sample.name}`
            const sent = failure.state.wire.requests.filter((request) => request.path === path)
            assert.equal(sent.length, 1)
            assert.equal(sent[0].status, 200)
            assert(!capturedReplayRequests(failure.state.network).some((request) => request.name.endsWith(path)))
        }
    }
}
const loaderMarker = 'compatibility loader fault canary'
writeFileSync(join(dist, 'loader.js'), `throw new Error(${JSON.stringify(loaderMarker)});\n`)
manifest.inputIntegrity = inputInventory(manifest)
run('loader-canary', 'update', { modes: 'loader', comparisons: 'current', scenarios: 'core' })
const loaderReport = JSON.parse(readFileSync(join(folder, 'loader-canary/report.json')))
assert.equal(loaderReport.completedRuns, 2)
assert.equal(loaderReport.passed, false)
for (const cell of loaderReport.results) {
    assert.equal(cell.status, 'failed')
    for (const run of cell.runs) {
        const failure = JSON.parse(readFileSync(join(run.folder, 'failure.json')))
        assert(failure.state.pageErrors.some((error) => error.message === loaderMarker))
        assert(
            failure.state.network.requests.some(
                (request) => request.path === '/static/loader.js' && request.status === 200
            )
        )
    }
}
const evidence = {
    passed: true,
    folder,
    integrityRejectedChangedBytes: true,
    browserEgressDenied: true,
    delayedReplayCompressionStable: true,
    missingCurrentCaptureLogRejected: true,
    throwingLoaderRejected: true,
    missingWebVitalsDeliveryRejected: vitalsReport.results.map((cell) => cell.coreFamily),
    missingReplayNetworkCaptureRejected: networkReport.results.map((cell) => cell.coreFamily),
    nativeThrowDetected: report.results.map((cell) => cell.coreFamily),
    failedRuns: report.completedRuns,
    expectedSnapshotsUnchanged: true,
}
writeFileSync(join(folder, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence, null, 2))
