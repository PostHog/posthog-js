import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
    buildGoldens,
    compareGoldens,
    updateGoldens,
    MATRIX,
    HISTORICAL_PACKAGES,
    historicalSource,
    deploymentFilename,
} from './golden.mjs'

const errorMessage = 'this.instance._shouldDisableFlags is not a function'
const digest = `sha256-${'a'.repeat(64)}`
const filenames = MATRIX.coreFamilies.flatMap((family) =>
    MATRIX.entrypoints.map((entrypoint) => deploymentFilename(family, entrypoint))
)
const singleSelection = { coreFamilies: ['current'], entrypoints: ['npm'], browsers: ['chromium'], scenarios: ['core'] }

function fixture({ selection = {}, repeats = 2, value = 'blue' } = {}) {
    const inventory = {
        source: { 'dirty-source-tree': digest },
        artifacts: { 'packed-core-and-extensions': digest },
        runtime: { 'harness-fixtures-normalizer': digest },
        browserTooling: { 'pinned-playwright-and-browsers': digest },
        historicalPackages: Object.fromEntries(
            Object.entries(HISTORICAL_PACKAGES).map(([role, pinned]) => [role, pinned.integrity])
        ),
    }
    const runs = []
    for (const coreFamily of selection.coreFamilies ?? MATRIX.coreFamilies) {
        for (const entrypoint of selection.entrypoints ?? MATRIX.entrypoints) {
            for (const browser of selection.browsers ?? MATRIX.browsers) {
                for (const scenario of selection.scenarios ?? MATRIX.scenarios) {
                    for (let repeat = 0; repeat < repeats; repeat++) {
                        runs.push({
                            coreFamily,
                            entrypoint,
                            browser,
                            scenario,
                            repeat,
                            status: 'passed',
                            assertionsPassed: true,
                            runtimeErrors: [],
                            functionalCoverage: 'fully-ready',
                            terminalOutcome: 'fully-ready',
                            observations: {
                                api: {
                                    result: value,
                                    callbacks: [{ value: 'first' }, { value: 'second' }],
                                    missingValue: { $kind: 'undefined' },
                                    nullable: null,
                                    unhandled: [],
                                },
                                network: {
                                    requests: [
                                        {
                                            body: {
                                                batch: [
                                                    { event: 'one', values: [1, 2] },
                                                    { event: 'two', values: [3, 4] },
                                                ],
                                            },
                                        },
                                    ],
                                    errors: [],
                                },
                                pageErrors: [],
                                unexpectedNetwork: [],
                            },
                            // These are diagnostic metadata, not golden content.
                            folder: '/tmp/run-1',
                            elapsed: 32,
                            commitSha: 'diagnostic-source-id',
                            actualVersion: '1.999.0',
                        })
                    }
                }
            }
        }
    }
    return {
        repeats,
        selection,
        runs,
        inputIntegrity: {
            expected: structuredClone(inventory),
            before: structuredClone(inventory),
            after: structuredClone(inventory),
        },
    }
}

async function sandbox(t) {
    const root = await fs.mkdtemp(join(tmpdir(), 'compatibility-golden-test-'))
    t.after(() => fs.rm(root, { recursive: true, force: true }))
    return { root, directory: join(root, 'goldens') }
}

async function bytes(directory) {
    return Object.fromEntries(
        await Promise.all(
            filenames.map(async (filename) => [filename, await fs.readFile(join(directory, filename), 'utf8')])
        )
    )
}

function reverseKeys(value) {
    if (Array.isArray(value)) return value.map(reverseKeys)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
        Object.entries(value)
            .reverse()
            .map(([key, item]) => [key, reverseKeys(item)])
    )
}

async function seed(t) {
    const space = await sandbox(t)
    await updateGoldens(space.directory, fixture())
    return { ...space, original: await bytes(space.directory) }
}

async function assertPreserved(space) {
    assert.deepEqual(await bytes(space.directory), space.original)
    assert.deepEqual(await fs.readdir(space.root), ['goldens'])
}

test('buildGoldens routes every required tuple to six stable deployment files', () => {
    const input = fixture()
    const result = buildGoldens(input)
    assert.equal(result.coverage, 'full')
    assert.equal(result.cellCount, 306)
    assert.deepEqual(result.functionalCoverage, { 'fully-ready': 306 })
    assert.equal(result.repeats, 2)
    assert.deepEqual(Object.keys(result.files), filenames)
    let cells = 0
    for (const coreFamily of MATRIX.coreFamilies) {
        for (const entrypoint of MATRIX.entrypoints) {
            const filename = deploymentFilename(coreFamily, entrypoint)
            const text = result.files[filename]
            const deployment = JSON.parse(text)
            assert.equal(deployment.schema, 1)
            assert.equal(deployment.coreFamily, coreFamily)
            assert.equal(deployment.entrypoint, entrypoint)
            if (coreFamily === 'historical')
                assert.equal(deployment.coreVersion, HISTORICAL_PACKAGES[historicalSource(entrypoint)].version)
            assert.deepEqual(Object.keys(deployment.browsers), [...MATRIX.browsers].sort())
            for (const browser of MATRIX.browsers) {
                assert.deepEqual(Object.keys(deployment.browsers[browser]), [...MATRIX.scenarios].sort())
                for (const scenario of MATRIX.scenarios) {
                    cells++
                    const cell = deployment.browsers[browser][scenario]
                    assert.equal(cell.functionalCoverage, 'fully-ready')
                    assert.equal(cell.terminalOutcome, 'fully-ready')
                    const run = input.runs.find(
                        (run) =>
                            run.coreFamily === coreFamily &&
                            run.entrypoint === entrypoint &&
                            run.browser === browser &&
                            run.scenario === scenario
                    )
                    assert.deepEqual(cell.observations, run.observations)
                    assert.deepEqual(Object.keys(cell).sort(), [
                        'functionalCoverage',
                        'observations',
                        'terminalOutcome',
                    ])
                }
            }
            assert.equal(text, `${JSON.stringify(deployment, null, 4)}\n`)
        }
    }
    assert.equal(cells, 306)
})

test('buildGoldens ignores arrival/key order but preserves normalized observations and ordered arrays', () => {
    const input = fixture()
    const expected = buildGoldens(input)
    const reordered = structuredClone(input)
    reordered.runs.reverse()
    reordered.selection = reverseKeys(reordered.selection)
    for (const run of reordered.runs) {
        run.observations = reverseKeys(run.observations)
        run.actualVersion = '1.1000.0'
        run.folder = '/tmp/another-run'
        run.commitSha = 'changed-source-id'
        run.elapsed = 99
    }
    assert.deepEqual(buildGoldens(reordered), expected)
    assert.deepEqual(buildGoldens(input), expected)
    assert.deepEqual(input, fixture())
})

test('buildGoldens requires exact membership, unique runs and all declared repetitions', async (t) => {
    const cases = [
        [
            'missing cell',
            (input) => {
                input.runs = input.runs.filter(
                    (run) =>
                        !(
                            run.coreFamily === 'current' &&
                            run.entrypoint === 'npm' &&
                            run.browser === 'chromium' &&
                            run.scenario === 'core'
                        )
                )
            },
            /Missing run/,
        ],
        [
            'missing repeat',
            (input) => {
                input.runs.pop()
            },
            /Missing run/,
        ],
        [
            'duplicate with unchanged row count',
            (input) => {
                input.runs[1] = structuredClone(input.runs[0])
            },
            /Duplicate run/,
        ],
        [
            'wrong tuple with unchanged row count',
            (input) => {
                input.runs[0].scenario = 'unknown'
            },
            /Unexpected tuple/,
        ],
        [
            'wrong attribution',
            (input) => {
                input.runs[0].coreFamily = 'unknown'
            },
            /Unexpected tuple/,
        ],
        [
            'non-string tuple value',
            (input) => {
                input.runs[0].coreFamily = ['current']
            },
            /Unexpected tuple/,
        ],
        [
            'one repeat',
            (input) => {
                input.repeats = 1
            },
            /At least two/,
        ],
        [
            'repeat outside range',
            (input) => {
                input.runs[0].repeat = 2
            },
            /invalid repeat/,
        ],
        [
            'fractional repeat',
            (input) => {
                input.runs[0].repeat = 0.5
            },
            /invalid repeat/,
        ],
        [
            'third repeat missing',
            (input) => {
                input.repeats = 3
            },
            /Missing run/,
        ],
        [
            'empty selection',
            (input) => {
                input.selection.browsers = []
            },
            /Invalid selection/,
        ],
        [
            'duplicate selector',
            (input) => {
                input.selection.browsers = ['chromium', 'chromium']
            },
            /Invalid selection/,
        ],
        [
            'null selector',
            (input) => {
                input.selection.browsers = null
            },
            /Invalid selection/,
        ],
        [
            'unknown dimension',
            (input) => {
                input.selection.engines = ['chromium']
            },
            /Unknown selection/,
        ],
        [
            'unselected tuple',
            (input) => {
                input.selection = singleSelection
            },
            /Unexpected tuple/,
        ],
    ]
    for (const [name, mutate, pattern] of cases) {
        await t.test(name, () => {
            const input = fixture()
            mutate(input)
            assert.throws(() => buildGoldens(input), pattern)
        })
    }
    assert.equal(buildGoldens(fixture({ repeats: 3 })).repeats, 3)
})

test('buildGoldens rejects differing repetitions with the exact cell and semantic path', () => {
    const input = fixture({ selection: singleSelection })
    input.runs[1].observations.api.result = 'red'
    assert.throws(
        () => buildGoldens(input),
        (error) => {
            assert.match(
                error.message,
                /current\/npm\/chromium\/core: repetitions differ.*\$\.observations\.api\.result/
            )
            assert.deepEqual(error.differences, [
                {
                    deployment: 'current-npm.json',
                    browser: 'chromium',
                    scenario: 'core',
                    path: '$.observations.api.result',
                    expected: 'blue',
                    actual: 'red',
                },
            ])
            return true
        }
    )
})

test('buildGoldens requires independent successful assertions and error-free runtime evidence', async (t) => {
    const cases = [
        [
            'failed assertion',
            (run) => {
                run.assertionsPassed = false
            },
        ],
        [
            'absent assertion proof',
            (run) => {
                delete run.assertionsPassed
            },
        ],
        [
            'unexpected status',
            (run) => {
                run.status = 'failed'
            },
        ],
        [
            'unexpected runtime error',
            (run) => {
                run.runtimeErrors.push({ name: 'Error', message: 'CDN canary' })
            },
        ],
        [
            'absent runtime proof',
            (run) => {
                delete run.runtimeErrors
            },
        ],
        [
            'page error contradicting success',
            (run) => {
                run.observations.pageErrors.push({ name: 'Error', message: 'canary' })
            },
        ],
        [
            'unhandled rejection',
            (run) => {
                run.observations.api.unhandled.push('rejected')
            },
        ],
        [
            'backend error',
            (run) => {
                run.observations.network.errors.push('decode failed')
            },
        ],
        [
            'unexpected destination',
            (run) => {
                run.observations.unexpectedNetwork.push('https://outside.example')
            },
        ],
        [
            'unexpected initialization error',
            (run) => {
                run.initializationError = { name: 'TypeError', message: errorMessage }
            },
        ],
    ]
    for (const [name, mutate] of cases) {
        await t.test(name, () => {
            const input = fixture({ selection: singleSelection })
            mutate(input.runs[0])
            assert.throws(() => buildGoldens(input), /assertions|runtime|initialization/)
        })
    }
})

test('buildGoldens requires full readiness and error-free historical slim execution', async (t) => {
    const selection = {
        coreFamilies: ['historical'],
        entrypoints: ['slim'],
        browsers: ['webkit'],
        scenarios: ['replay'],
    }
    for (const [name, mutate] of [
        [
            'incomplete readiness',
            (run) => {
                run.functionalCoverage = 'initialization-failure-only'
            },
        ],
        [
            'failed terminal outcome',
            (run) => {
                run.terminalOutcome = 'initialization-failure'
            },
        ],
        [
            'initialization error',
            (run) => {
                run.initializationError = { name: 'TypeError', message: errorMessage }
            },
        ],
        [
            'page error',
            (run) => {
                run.observations.pageErrors.push({ name: 'TypeError', message: errorMessage })
            },
        ],
    ]) {
        await t.test(name, () => {
            const input = fixture({ selection })
            mutate(input.runs[0])
            assert.throws(() => buildGoldens(input), /fully-ready|initialization|runtime/)
        })
    }
})

test('buildGoldens requires complete matching pinned input inventories before and after execution', async (t) => {
    const cases = [
        [
            'no proof',
            (input) => {
                delete input.inputIntegrity
            },
        ],
        [
            'no expected proof',
            (input) => {
                delete input.inputIntegrity.expected
            },
        ],
        [
            'no after proof',
            (input) => {
                delete input.inputIntegrity.after
            },
        ],
        [
            'empty inventory',
            (input) => {
                input.inputIntegrity.before.runtime = {}
            },
        ],
        [
            'missing category',
            (input) => {
                delete input.inputIntegrity.after.browserTooling
            },
        ],
        [
            'unpinned historical bytes',
            (input) => {
                input.inputIntegrity.before.historicalPackages.historical = 'sha512-other'
            },
        ],
        [
            'unpinned slim bytes',
            (input) => {
                input.inputIntegrity.before.historicalPackages['historical-slim'] = 'sha512-other'
            },
        ],
        [
            'missing slim pin',
            (input) => {
                delete input.inputIntegrity.before.historicalPackages['historical-slim']
            },
        ],
        [
            'invalid digest',
            (input) => {
                input.inputIntegrity.before.source['dirty-source-tree'] = 'HEAD'
            },
        ],
        [
            'changed source',
            (input) => {
                input.inputIntegrity.after.source['dirty-source-tree'] = `sha256-${'b'.repeat(64)}`
            },
        ],
        [
            'changed expected artifact',
            (input) => {
                input.inputIntegrity.expected.artifacts['packed-core-and-extensions'] = `sha256-${'b'.repeat(64)}`
            },
        ],
        [
            'removed input',
            (input) => {
                input.inputIntegrity.after.runtime = { other: digest }
            },
        ],
        [
            'extra input',
            (input) => {
                input.inputIntegrity.after.artifacts.newArtifact = digest
            },
        ],
    ]
    for (const [name, mutate] of cases) {
        await t.test(name, () => {
            const input = fixture({ selection: singleSelection })
            mutate(input)
            assert.throws(() => buildGoldens(input), /inputIntegrity|integrity/)
        })
    }
})

test('buildGoldens fails closed on lossy JSON values rather than changing their semantics', async (t) => {
    const cases = [
        ['undefined', () => undefined],
        ['NaN', () => NaN],
        ['Infinity', () => Infinity],
        ['negative zero', () => -0],
        ['bigint', () => 1n],
        ['date', () => new Date(0)],
        ['sparse array', () => new Array(2)],
        ['extended array', () => Object.assign([], { extra: 'lost' })],
        ['non-enumerable array extension', () => Object.defineProperty([], 'extra', { value: 'lost' })],
        [
            'array accessor',
            () =>
                Object.defineProperty([1], '0', {
                    get() {
                        throw new Error('Accessor must not execute')
                    },
                }),
        ],
        [
            'cyclic object',
            () => {
                const value = {}
                value.self = value
                return value
            },
        ],
        [
            'accessor',
            () => ({
                get value() {
                    return 'lost'
                },
            }),
        ],
        ['non-enumerable', () => Object.defineProperty({}, 'value', { value: 'lost' })],
        ['symbol key', () => ({ [Symbol('key')]: 'lost' })],
    ]
    for (const [name, create] of cases) {
        await t.test(name, () => {
            const input = fixture({ selection: singleSelection })
            input.runs[0].observations.api.value = create()
            assert.throws(() => buildGoldens(input), /JSON|Cyclic|Sparse|Symbol|plain/)
        })
    }
})

test('compareGoldens reports a small semantic API change at its deployment/browser/scenario/path without writing', async (t) => {
    const space = await seed(t)
    assert.deepEqual(await compareGoldens(space.directory, fixture()), {
        coverage: 'full',
        cellCount: 306,
        functionalCoverage: { 'fully-ready': 306 },
        repeats: 2,
        matched: true,
        differenceCount: 0,
        differences: [],
    })
    const input = fixture()
    for (const run of input.runs) {
        if (
            run.coreFamily === 'current' &&
            run.entrypoint === 'npm' &&
            run.browser === 'chromium' &&
            run.scenario === 'core'
        )
            run.observations.api.result = 'red'
    }
    const report = await compareGoldens(space.directory, input)
    assert.equal(report.coverage, 'full')
    assert.equal(report.matched, false)
    assert.equal(report.differenceCount, 1)
    assert.deepEqual(report.differences, [
        {
            deployment: 'current-npm.json',
            browser: 'chromium',
            scenario: 'core',
            path: '$.observations.api.result',
            expected: 'blue',
            actual: 'red',
        },
    ])
    assert.deepEqual(JSON.parse(JSON.stringify(report)), report)
    await assertPreserved(space)
})

test('compareGoldens reports a small ordered payload value change at its exact path', async (t) => {
    const space = await seed(t)
    const input = fixture({ selection: singleSelection })
    for (const run of input.runs) run.observations.network.requests[0].body.batch[0].values[0] = 42
    const report = await compareGoldens(space.directory, input)
    assert.equal(report.matched, false)
    assert.equal(report.differenceCount, 1)
    assert.deepEqual(report.differences, [
        {
            deployment: 'current-npm.json',
            browser: 'chromium',
            scenario: 'core',
            path: '$.observations.network.requests[0].body.batch[0].values[0]',
            expected: 1,
            actual: 42,
        },
    ])
    await assertPreserved(space)
})

test('buildGoldens retains normalized core/extension version roles and application strings', () => {
    const input = fixture({ selection: singleSelection })
    for (const run of input.runs) {
        run.observations.api.versionRoles = {
            core: '<core-version>',
            extension: '<extension-version>',
            application: '1.999.0',
        }
    }
    const serialized = JSON.parse(buildGoldens(input).files['current-npm.json'])
    assert.deepEqual(serialized.browsers.chromium.core.observations.api.versionRoles, {
        core: '<core-version>',
        extension: '<extension-version>',
        application: '1.999.0',
    })
})

test('compareGoldens reports historical slim with full readiness coverage', async (t) => {
    const space = await seed(t)
    const input = fixture({
        selection: {
            coreFamilies: ['historical'],
            entrypoints: ['slim'],
            browsers: ['webkit'],
            scenarios: ['logs'],
        },
    })
    const report = await compareGoldens(space.directory, input)
    assert.equal(report.coverage, 'partial')
    assert.equal(report.matched, true)
    assert.deepEqual(report.functionalCoverage, { 'fully-ready': 1 })
    const filename = 'historical-1.407.6-slim.json'
    const deployment = JSON.parse(await fs.readFile(join(space.directory, filename), 'utf8'))
    deployment.coreVersion = '1.354.0'
    await fs.writeFile(join(space.directory, filename), JSON.stringify(deployment))
    await assert.rejects(compareGoldens(space.directory, input), /attribution/)
})

test('compareGoldens detects nested request-batch and callback reordering', async (t) => {
    const space = await seed(t)
    const input = fixture({ selection: singleSelection })
    for (const run of input.runs) {
        run.observations.network.requests[0].body.batch.reverse()
        run.observations.api.callbacks.reverse()
    }
    const report = await compareGoldens(space.directory, input)
    assert.equal(report.coverage, 'partial')
    assert.equal(report.matched, false)
    assert.equal(report.differenceCount, 8)
    assert.deepEqual(
        report.differences.filter((diff) => diff.path.endsWith('.event')),
        [
            {
                deployment: 'current-npm.json',
                browser: 'chromium',
                scenario: 'core',
                path: '$.observations.network.requests[0].body.batch[0].event',
                expected: 'one',
                actual: 'two',
            },
            {
                deployment: 'current-npm.json',
                browser: 'chromium',
                scenario: 'core',
                path: '$.observations.network.requests[0].body.batch[1].event',
                expected: 'two',
                actual: 'one',
            },
        ]
    )
    assert.equal(report.differences[0].path, '$.observations.api.callbacks[0].value')
    await assertPreserved(space)
})

test('compareGoldens distinguishes missing, null, encoded undefined and special-key paths', async (t) => {
    const space = await seed(t)
    const input = fixture({ selection: singleSelection })
    for (const run of input.runs) {
        delete run.observations.api.nullable
        run.observations.api.missingValue = null
        run.observations.api['property.with.dot'] = 7
    }
    const report = await compareGoldens(space.directory, input)
    assert.deepEqual(
        report.differences.map(({ path, ...rest }) => [path, rest.missing ?? 'value']),
        [
            ['$.observations.api.missingValue', 'value'],
            ['$.observations.api.nullable', 'actual'],
            ['$.observations.api["property.with.dot"]', 'expected'],
        ]
    )
    const roundTrip = JSON.parse(JSON.stringify(report))
    assert.equal(roundTrip.differences[1].expected, null)
    assert.equal(roundTrip.differences[1].missing, 'actual')
    assert.deepEqual(roundTrip.differences[0].expected, { $kind: 'undefined' })
})

test('compareGoldens labels focused checks partial and compares only the selected scope', async (t) => {
    const space = await seed(t)
    const changed = JSON.parse(space.original['current-npm.json'])
    delete changed.browsers.firefox
    changed.browsers.chromium.logs.observations.api.result = 'changed outside selection'
    await fs.writeFile(join(space.directory, 'current-npm.json'), JSON.stringify(changed))
    await fs.unlink(join(space.directory, 'historical-1.354.0-snippet.json'))
    const report = await compareGoldens(space.directory, fixture({ selection: singleSelection }))
    assert.equal(report.coverage, 'partial')
    assert.equal(report.cellCount, 1)
    assert.deepEqual(report.functionalCoverage, { 'fully-ready': 1 })
    assert.equal(report.matched, true)
    assert.equal(report.differenceCount, 0)
    await assert.rejects(compareGoldens(space.directory, fixture()), /browsers must contain exactly/)
})

test('compareGoldens reports missing selected cells or files and rejects misattributed/corrupt files', async (t) => {
    const { directory } = await sandbox(t)
    const input = fixture({ selection: singleSelection })
    let report = await compareGoldens(directory, input)
    assert.equal(report.differenceCount, 1)
    assert.equal(report.differences[0].missing, 'expected')
    await fs.mkdir(directory)
    const deployment = JSON.parse(buildGoldens(input).files['current-npm.json'])
    deployment.browsers.chromium = {}
    await fs.writeFile(join(directory, 'current-npm.json'), JSON.stringify(deployment))
    report = await compareGoldens(directory, input)
    assert.equal(report.differences[0].scenario, 'core')
    deployment.coreFamily = 'historical'
    await fs.writeFile(join(directory, 'current-npm.json'), JSON.stringify(deployment))
    await assert.rejects(compareGoldens(directory, input), /attribution/)
    await fs.writeFile(join(directory, 'current-npm.json'), '{invalid')
    await assert.rejects(compareGoldens(directory, input), SyntaxError)
})

test('updateGoldens explicitly bootstraps and replaces the whole six-file set', async (t) => {
    const space = await sandbox(t)
    const input = fixture()
    const first = await updateGoldens(space.directory, input)
    assert.deepEqual(first, {
        coverage: 'full',
        cellCount: 306,
        functionalCoverage: { 'fully-ready': 306 },
        repeats: 2,
        updated: true,
    })
    assert.deepEqual(await bytes(space.directory), buildGoldens(input).files)
    await updateGoldens(space.directory, fixture({ value: 'reviewed-change' }))
    assert.equal((await compareGoldens(space.directory, fixture({ value: 'reviewed-change' }))).matched, true)
    assert.deepEqual(await fs.readdir(space.root), ['goldens'])
})

test('updateGoldens refuses partial, failed, incomplete, nondeterministic and changed-input runs without filesystem writes', async (t) => {
    const space = await seed(t)
    const cases = [
        ['partial', () => fixture({ selection: singleSelection })],
        [
            'assertion failure',
            () => {
                const input = fixture()
                input.runs[0].assertionsPassed = false
                return input
            },
        ],
        [
            'missing cell',
            () => {
                const input = fixture()
                input.runs.pop()
                return input
            },
        ],
        [
            'duplicate cell',
            () => {
                const input = fixture()
                input.runs.push(input.runs[0])
                return input
            },
        ],
        [
            'nondeterministic',
            () => {
                const input = fixture()
                input.runs[1].observations.api.result = 'red'
                return input
            },
        ],
        [
            'changed input',
            () => {
                const input = fixture()
                input.inputIntegrity.after.source['dirty-source-tree'] = `sha256-${'b'.repeat(64)}`
                return input
            },
        ],
        [
            'runtime failure',
            () => {
                const input = fixture()
                input.runs[0].runtimeErrors = ['CDN canary']
                return input
            },
        ],
    ]
    for (const [name, create] of cases) {
        await t.test(name, async () => {
            let calls = 0
            const fileSystem = new Proxy(
                {},
                {
                    get() {
                        calls++
                        throw new Error('Filesystem must not be touched')
                    },
                }
            )
            await assert.rejects(
                updateGoldens(space.directory, create(), { fileSystem }),
                /Partial|assertions|Missing|Duplicate|repetitions|integrity|runtime/
            )
            assert.equal(calls, 0)
            await assertPreserved(space)
        })
    }
})

test('updateGoldens preserves existing bytes when staging writes fail or readback is corrupt', async (t) => {
    for (const failure of ['write', 'readback']) {
        await t.test(failure, async (t) => {
            const space = await seed(t)
            let writes = 0
            let renames = 0
            const fileSystem = {
                ...fs,
                async writeFile(...args) {
                    writes++
                    if (failure === 'write' && writes === 4) throw new Error('Injected staged write failure')
                    return fs.writeFile(...args)
                },
                async readFile(...args) {
                    const text = await fs.readFile(...args)
                    return failure === 'readback' ? text.replace('blue', 'corrupt') : text
                },
                async rename(...args) {
                    renames++
                    return fs.rename(...args)
                },
            }
            await assert.rejects(
                updateGoldens(space.directory, fixture({ value: 'blue-updated' }), { fileSystem }),
                /staged write|Staged write verification/
            )
            assert.equal(renames, 0)
            assert.equal(writes, failure === 'write' ? 4 : 6)
            await assertPreserved(space)
        })
    }
})

test('updateGoldens refuses an unexpected staged entry before publication', async (t) => {
    const space = await seed(t)
    let injected = false
    let renames = 0
    const fileSystem = {
        ...fs,
        async writeFile(path, ...args) {
            await fs.writeFile(path, ...args)
            if (!injected) {
                injected = true
                await fs.writeFile(join(path, '..', 'extra.json'), '{}')
            }
        },
        async rename(...args) {
            renames++
            return fs.rename(...args)
        },
    }
    await assert.rejects(updateGoldens(space.directory, fixture(), { fileSystem }), /exactly the six/)
    assert.equal(renames, 0)
    await assertPreserved(space)
})

test('updateGoldens stages and validates all six files before touching the previous directory', async (t) => {
    const space = await seed(t)
    const input = fixture({ value: 'reviewed-change' })
    const expected = buildGoldens(input).files
    let reads = 0
    let renames = 0
    const fileSystem = {
        ...fs,
        async readFile(...args) {
            reads++
            return fs.readFile(...args)
        },
        async rename(from, to) {
            renames++
            assert.equal(reads, 6)
            if (renames === 1) {
                assert.equal(from, space.directory)
                assert.deepEqual(await bytes(space.directory), space.original)
                assert.deepEqual(await bytes(join(to, '..', 'next')), expected)
            } else {
                assert.equal(to, space.directory)
                assert.deepEqual(await bytes(from), expected)
            }
            return fs.rename(from, to)
        },
    }
    await updateGoldens(space.directory, input, { fileSystem })
    assert.equal(renames, 2)
    assert.deepEqual(await bytes(space.directory), expected)
})

test('updateGoldens restores the complete previous set on directory publication failure', async (t) => {
    const space = await seed(t)
    let renames = 0
    const fileSystem = {
        ...fs,
        async rename(from, to) {
            renames++
            if (renames === 2) throw new Error('Injected directory publication failure')
            return fs.rename(from, to)
        },
    }
    await assert.rejects(
        updateGoldens(space.directory, fixture({ value: 'changed' }), { fileSystem }),
        /publication failure/
    )
    assert.equal(renames, 3)
    await assertPreserved(space)
})

test('updateGoldens leaves the original intact if moving it to backup fails', async (t) => {
    const space = await seed(t)
    const fileSystem = {
        ...fs,
        async rename() {
            throw new Error('Injected backup failure')
        },
    }
    await assert.rejects(
        updateGoldens(space.directory, fixture({ value: 'changed' }), { fileSystem }),
        /backup failure/
    )
    await assertPreserved(space)
})

test('updateGoldens retains a recoverable complete backup if publication and rollback both fail', async (t) => {
    const space = await seed(t)
    let renames = 0
    const fileSystem = {
        ...fs,
        async rename(...args) {
            renames++
            if (renames >= 2) throw new Error('Injected rename failure')
            return fs.rename(...args)
        },
    }
    let failure
    await assert.rejects(updateGoldens(space.directory, fixture({ value: 'changed' }), { fileSystem }), (error) => {
        failure = error
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors.length, 2)
        assert.match(error.message, /recover/)
        return true
    })
    assert.deepEqual(await bytes(failure.recoveryDirectory), space.original)
    await assert.rejects(fs.lstat(space.directory), { code: 'ENOENT' })
    await fs.rename(failure.recoveryDirectory, space.directory)
    await fs.rm(join(failure.recoveryDirectory, '..'), { recursive: true })
    await assertPreserved(space)
})

test('updateGoldens failure during first publication leaves no partial bootstrap set', async (t) => {
    const space = await sandbox(t)
    const fileSystem = {
        ...fs,
        async rename() {
            throw new Error('Injected bootstrap failure')
        },
    }
    await assert.rejects(updateGoldens(space.directory, fixture(), { fileSystem }), /bootstrap failure/)
    assert.deepEqual(await fs.readdir(space.root), [])
})

test('updateGoldens refuses unrelated entries, incomplete sets and symlink targets without moving them', async (t) => {
    const space = await seed(t)
    await fs.writeFile(join(space.directory, 'unrelated.txt'), 'preserve')
    await assert.rejects(updateGoldens(space.directory, fixture()), /exactly the six/)
    assert.equal(await fs.readFile(join(space.directory, 'unrelated.txt'), 'utf8'), 'preserve')
    assert.deepEqual(await bytes(space.directory), space.original)
    await fs.unlink(join(space.directory, 'unrelated.txt'))
    const linked = join(space.root, 'linked')
    await fs.symlink(space.directory, linked)
    await assert.rejects(updateGoldens(linked, fixture()), /dedicated directory/)
    await fs.unlink(linked)
    await fs.unlink(join(space.directory, filenames[0]))
    await assert.rejects(updateGoldens(space.directory, fixture()), /exactly the six/)
    await fs.symlink(join(space.directory, filenames[1]), join(space.directory, filenames[0]))
    await assert.rejects(updateGoldens(space.directory, fixture()), /regular golden file/)
})

test('updateGoldens reports cleanup failure after a failed staged write while preserving the previous set', async (t) => {
    const space = await seed(t)
    const fileSystem = {
        ...fs,
        async writeFile() {
            throw new Error('Injected staged write failure')
        },
        async rm() {
            throw new Error('Injected cleanup failure')
        },
    }
    await assert.rejects(updateGoldens(space.directory, fixture(), { fileSystem }), (error) => {
        assert.match(error.message, /staged write failure/)
        assert.match(error.cleanupWarning, /transaction.*cleanup failure/)
        return true
    })
    assert.deepEqual(await bytes(space.directory), space.original)
})

test('updateGoldens distinguishes successful publication with cleanup warning from a failed update', async (t) => {
    const space = await seed(t)
    const fileSystem = {
        ...fs,
        async rm() {
            throw new Error('Injected cleanup failure')
        },
    }
    const input = fixture({ value: 'reviewed-change' })
    const result = await updateGoldens(space.directory, input, { fileSystem })
    assert.equal(result.updated, true)
    assert.match(result.cleanupWarning, /transaction.*cleanup failure/)
    assert.equal((await compareGoldens(space.directory, input)).matched, true)
    const transactions = (await fs.readdir(space.root)).filter((name) => name !== 'goldens')
    assert.equal(transactions.length, 1)
    assert.deepEqual(await bytes(join(space.root, transactions[0], 'previous')), space.original)
})
