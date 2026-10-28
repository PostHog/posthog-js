import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { MATRIX, HISTORICAL_PACKAGES, buildGoldens, deploymentEntrypoints } from './golden.mjs'
import { runMatrix } from './matrix.mjs'

function passed(observations = { value: 'same' }) {
    return {
        status: 'passed',
        assertionsPassed: true,
        runtimeErrors: [],
        functionalCoverage: 'fully-ready',
        terminalOutcome: 'fully-ready',
        observations,
        diagnostic: 'retained',
    }
}

function options(overrides = {}) {
    return {
        engines: [...MATRIX.browsers],
        modes: ['npm'],
        comparisons: ['current'],
        scenarios: ['core'],
        repeats: 2,
        launch: async (engine) => ({ version: () => `${engine}-version`, close: async () => {} }),
        runCell: async () => passed(),
        onCell() {},
        ...overrides,
    }
}

test('engine lanes overlap while each lane keeps cells and repetitions sequential', async () => {
    const gate = Promise.withResolvers()
    const calls = Object.fromEntries(MATRIX.browsers.map((engine) => [engine, []]))
    const active = new Set()
    const progress = []
    const pending = runMatrix(
        options({
            scenarios: ['core', 'replay'],
            async runCell(_browser, { engine, scenario, repeat }) {
                assert(!active.has(engine), `${engine} started overlapping executions`)
                active.add(engine)
                calls[engine].push(`${scenario}/${repeat}`)
                await gate.promise
                active.delete(engine)
                return passed()
            },
            onCell(_result, completed) {
                progress.push(completed)
            },
        })
    )
    let output
    try {
        await setImmediate()
        assert.deepEqual([...active], MATRIX.browsers)
        for (const engine of MATRIX.browsers) assert.deepEqual(calls[engine], ['core/0'])
    } finally {
        gate.resolve()
        output = await pending
    }
    assert.deepEqual(output.cellFailures, [])
    assert.equal(output.runs.length, 12)
    assert.equal(output.results.length, 6)
    for (const engine of MATRIX.browsers) assert.deepEqual(calls[engine], ['core/0', 'core/1', 'replay/0', 'replay/1'])
    assert.deepEqual(
        progress.map((completed) => completed.length),
        [1, 2, 3, 4, 5, 6]
    )
    assert.deepEqual(progress.at(-1), output.results)
})

test('parallel engines run the loader only with current cores', async () => {
    const output = await runMatrix(options({ modes: ['loader'], comparisons: ['current', 'historical'] }))
    assert.equal(output.runs.length, 6)
    assert.equal(output.results.length, 3)
    assert(output.runs.every((run) => run.coreFamily === 'current' && run.entrypoint === 'loader'))
    assert.deepEqual(output.cellFailures, [])
})

test('the full matrix preserves ordered run evidence and coverage despite reverse engine completion', async () => {
    const gates = Object.fromEntries(MATRIX.browsers.map((engine) => [engine, Promise.withResolvers()]))
    const closed = []
    const settings = options({
        modes: [...MATRIX.entrypoints],
        comparisons: [...MATRIX.coreFamilies],
        scenarios: [...MATRIX.scenarios],
        launch: async (engine) => ({
            version: () => `${engine}-version`,
            close: async () => closed.push(engine),
        }),
        async runCell(_browser, { engine, mode, comparison, scenario }) {
            await gates[engine].promise
            return passed({ engine, mode, comparison, scenario })
        },
    })
    const pending = runMatrix(settings)
    let output
    try {
        for (const engine of [...settings.engines].reverse()) {
            gates[engine].resolve()
            await setImmediate()
            assert.equal(closed.at(-1), engine)
        }
    } finally {
        for (const gate of Object.values(gates)) gate.resolve()
        output = await pending
    }
    assert.deepEqual(output.cellFailures, [])
    assert.deepEqual(Object.keys(output.browserVersions), settings.engines)
    assert.deepEqual(
        output.runs.map(({ browser, entrypoint, coreFamily, scenario, repeat }) => [
            browser,
            entrypoint,
            coreFamily,
            scenario,
            repeat,
        ]),
        settings.engines.flatMap((engine) =>
            settings.modes.flatMap((mode) =>
                settings.comparisons
                    .filter((comparison) => deploymentEntrypoints(comparison, [mode]).length)
                    .flatMap((comparison) =>
                        settings.scenarios.flatMap((scenario) =>
                            Array.from({ length: settings.repeats }, (_, repeat) => [
                                engine,
                                mode,
                                comparison,
                                scenario,
                                repeat,
                            ])
                        )
                    )
            )
        )
    )
    assert(output.runs.every((run) => run.diagnostic === 'retained' && run.observations))
    assert(output.results.every((cell) => cell.runs.every((run) => run.observations === undefined)))
    const inventory = {
        ...Object.fromEntries(
            ['source', 'artifacts', 'runtime', 'browserTooling'].map((key) => [
                key,
                { 'matrix-test': `sha256-${'a'.repeat(64)}` },
            ])
        ),
        historicalPackages: Object.fromEntries(
            Object.entries(HISTORICAL_PACKAGES).map(([role, pin]) => [role, pin.integrity])
        ),
    }
    const built = buildGoldens({
        repeats: settings.repeats,
        inputIntegrity: { expected: inventory, before: inventory, after: inventory },
        runs: output.runs,
    })
    const deploymentCount = settings.comparisons.reduce(
        (count, comparison) => count + deploymentEntrypoints(comparison, settings.modes).length,
        0
    )
    const cellCount = settings.engines.length * deploymentCount * settings.scenarios.length
    assert.equal(output.runs.length, cellCount * settings.repeats)
    assert.equal(output.results.length, cellCount)
    assert.equal(built.coverage, 'full')
    assert.equal(built.cellCount, cellCount)
    assert.equal(Object.keys(built.files).length, deploymentCount)
})

for (const stage of ['launch', 'run', 'close']) {
    test(`${stage} failure retains evidence and waits for the other engines to close`, async () => {
        const gate = Promise.withResolvers()
        const closed = []
        let progress = []
        let settled = false
        const pending = runMatrix(
            options({
                async launch(engine) {
                    if (engine === 'firefox' && stage === 'launch') throw new Error('launch failed')
                    return {
                        version: () => `${engine}-version`,
                        async close() {
                            closed.push(engine)
                            if (engine === 'firefox' && stage === 'close') throw new Error('close failed')
                        },
                    }
                },
                async runCell(_browser, { engine }) {
                    if (engine === 'firefox' && stage === 'run') throw new Error('run failed')
                    if (engine === 'webkit') await gate.promise
                    return passed()
                },
                onCell(_result, completed) {
                    progress = completed
                },
            })
        ).then(
            (value) => {
                settled = true
                return { value }
            },
            (error) => {
                settled = true
                return { error }
            }
        )
        let output
        try {
            await setImmediate()
            assert.equal(settled, false)
            assert(closed.includes('chromium'))
            assert.equal(closed.includes('firefox'), stage !== 'launch')
        } finally {
            gate.resolve()
            output = await pending
        }
        if (stage === 'launch') {
            assert.deepEqual(output.value.cellFailures, [{ engine: 'firefox', error: 'launch failed' }])
        } else {
            assert(output.error instanceof AggregateError)
            assert.equal(output.error.errors.length, 1)
            assert.equal(output.error.errors[0].message, 'firefox engine failed')
            assert.equal(output.error.errors[0].cause.message, `${stage} failed`)
        }
        assert.equal(closed.filter((engine) => engine === 'webkit').length, 1)
        for (const engine of ['chromium', 'webkit']) {
            const cell = progress.find((result) => result.browser === engine)
            assert.equal(cell.runs.length, 2)
            assert.equal(cell.status, 'passed')
        }
    })
}

test('failed runs and unequal repetitions remain failed cells without losing other evidence', async () => {
    const output = await runMatrix(
        options({
            async runCell(_browser, { engine, repeat }) {
                if (engine === 'chromium' && repeat === 0) return { status: 'failed', error: 'assertion failed' }
                return passed({ value: engine === 'firefox' ? repeat : 'same' })
            },
        })
    )
    assert.deepEqual(output.cellFailures, [])
    assert.equal(output.runs.length, 6)
    assert.deepEqual(
        output.results.map(({ status }) => status),
        ['failed', 'failed', 'passed']
    )
    assert.equal(output.results[0].runs[0].error, 'assertion failed')
    assert.equal(output.results[1].differences.length, 1)
    assert.equal(output.results[1].differences[0].count, 1)
})
