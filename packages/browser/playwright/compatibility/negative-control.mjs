/* eslint-disable no-console -- Standalone browser test fixtures exercise public APIs without importing SDK runtime helpers. */
import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseOptions } from './options.mjs'
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
const run = (name, operation) => {
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
            'npm',
            '--comparisons',
            'current,historical',
            '--scenarios',
            'surveys',
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
const evidence = {
    passed: true,
    folder,
    integrityRejectedChangedBytes: true,
    browserEgressDenied: true,
    nativeThrowDetected: report.results.map((cell) => cell.coreFamily),
    failedRuns: report.completedRuns,
    expectedSnapshotsUnchanged: true,
}
writeFileSync(join(folder, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n')
console.log(JSON.stringify(evidence, null, 2))
