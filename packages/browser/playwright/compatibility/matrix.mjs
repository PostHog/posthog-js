import { differences } from './normalize.mjs'

export async function runMatrix({ engines, modes, comparisons, scenarios, repeats, launch, runCell, onCell }) {
    const lanes = engines.map((engine) => ({ engine, runs: [], results: [], failures: [] }))
    const outcomes = await Promise.allSettled(
        lanes.map(async (lane) => {
            const { engine } = lane
            let browser
            try {
                browser = await launch(engine)
                lane.version = browser.version()
            } catch (error) {
                lane.failures.push({ engine, error: error.message })
                return
            }
            try {
                for (const mode of modes)
                    for (const comparison of comparisons)
                        for (const scenario of scenarios) {
                            const cell = {
                                browser: engine,
                                entrypoint: mode,
                                coreFamily: comparison,
                                scenario,
                            }
                            const result = { ...cell, status: 'passed', runs: [], differences: [] }
                            let expected
                            for (let repeat = 0; repeat < repeats; repeat++) {
                                const run = {
                                    ...cell,
                                    repeat,
                                    ...(await runCell(browser, { engine, mode, comparison, scenario, repeat })),
                                }
                                lane.runs.push(run)
                                result.runs.push({ ...run, observations: undefined })
                                if (run.status !== 'passed') result.status = 'failed'
                                else if (!expected) expected = run.observations
                                else {
                                    const diff = differences(expected, run.observations)
                                    if (diff.length) {
                                        result.status = 'failed'
                                        result.differences.push({
                                            label: run.label,
                                            count: diff.length,
                                            differences: diff,
                                        })
                                    }
                                }
                            }
                            lane.results.push(result)
                            await onCell(
                                result,
                                lanes.flatMap(({ results }) => results)
                            )
                        }
            } finally {
                await browser.close()
            }
        })
    )
    const errors = outcomes.flatMap((outcome, index) =>
        outcome.status === 'rejected' ? [new Error(`${engines[index]} engine failed`, { cause: outcome.reason })] : []
    )
    if (errors.length) throw new AggregateError(errors, 'Browser engine execution failed')
    return {
        runs: lanes.flatMap(({ runs }) => runs),
        results: lanes.flatMap(({ results }) => results),
        cellFailures: lanes.flatMap(({ failures }) => failures),
        browserVersions: Object.fromEntries(
            lanes.filter(({ version }) => version !== undefined).map(({ engine, version }) => [engine, version])
        ),
    }
}
