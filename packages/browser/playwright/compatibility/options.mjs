export function parseOptions(argv, allowed) {
    const result = {}
    if (argv.length % 2) throw new Error('Each option requires a value')
    for (let index = 0; index < argv.length; index += 2) {
        const key = argv[index].replace(/^--/, '')
        const value = argv[index + 1]
        if (!argv[index].startsWith('--') || !allowed.includes(key)) throw new Error(`Unknown option: ${argv[index]}`)
        if (key in result) throw new Error(`Duplicate option: ${key}`)
        if (!value || value.startsWith('--')) throw new Error(`Missing value: ${key}`)
        result[key] = value
    }
    return result
}

export function selection(all, argument, name) {
    const result = argument === undefined ? all : argument.split(',')
    if (result.some((value) => !all.includes(value)) || new Set(result).size !== result.length)
        throw new Error(`Invalid --${name}: ${argument}`)
    return result
}

export function identicalArtifacts(main, candidate) {
    const inventory = (source) => Object.entries(source.files).sort(([a], [b]) => a.localeCompare(b))
    return (
        main.version === candidate.version && JSON.stringify(inventory(main)) === JSON.stringify(inventory(candidate))
    )
}

export function completeCoverage(results, { engines, modes, comparisons, scenarios, repeats, cellFailures }) {
    if (repeats < 2 || cellFailures.length) return false
    const completed = new Set(
        results.map((result) => JSON.stringify([result.engine, result.mode, result.comparison, result.scenario]))
    )
    return engines.every((engine) =>
        modes.every((mode) =>
            comparisons.every((comparison) =>
                scenarios.every((scenario) => completed.has(JSON.stringify([engine, mode, comparison, scenario])))
            )
        )
    )
}
