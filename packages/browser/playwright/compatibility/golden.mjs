/* eslint-disable posthog-js/no-direct-boolean-check, posthog-js/no-direct-number-check -- Standalone Node serialization must not depend on the SDK runtime. */
import * as fs from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

export const MATRIX = Object.freeze({
    coreFamilies: Object.freeze(['current', 'historical']),
    entrypoints: Object.freeze(['snippet', 'npm', 'slim']),
    browsers: Object.freeze(['chromium', 'firefox', 'webkit']),
    scenarios: Object.freeze([
        'core',
        'autocapture',
        'surveys',
        'logs',
        'replay',
        'disabled',
        'extension-failure',
        'delayed-loading',
        'unload',
        'version-fallback',
        'cleanup',
        'forms',
        'links',
        'rage-clicks',
        'dead-clicks',
        'scrolling',
        'heatmaps',
    ]),
})

export const HISTORICAL_PACKAGES = Object.freeze({
    historical: Object.freeze({
        version: '1.354.0',
        integrity: 'sha512-qrpToz7mN1PmEfo+Ob4Z8euX4z2p17LA0EAtFeyod3IVnlwnu+Ybea/oxVsPiq5YAPo+p5z73FcjF2yEJ7oZnA==',
    }),
    'historical-slim': Object.freeze({
        version: '1.407.6',
        integrity: 'sha512-oXoDlFf1HdwvjmorcMrqeRlYHNY3WdwYvyYg4/L1dXTewltkDC9UQkbxZgSqGEsUcsniocfUpu3JxVICTseKqg==',
    }),
})

export function historicalSource(entrypoint) {
    return entrypoint === 'slim' ? 'historical-slim' : 'historical'
}

export function deploymentFilename(coreFamily, entrypoint) {
    const family =
        coreFamily === 'historical'
            ? `historical-${HISTORICAL_PACKAGES[historicalSource(entrypoint)].version}`
            : coreFamily
    return `${family}-${entrypoint}.json`
}
const dimensions = Object.keys(MATRIX)
const tupleFields = ['coreFamily', 'entrypoint', 'browser', 'scenario']
const filenames = MATRIX.coreFamilies.flatMap((coreFamily) =>
    MATRIX.entrypoints.map((entrypoint) => deploymentFilename(coreFamily, entrypoint))
)

function requireCondition(condition, message) {
    if (!condition) throw new Error(message)
}

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sameKeys(value, keys, label) {
    requireCondition(isObject(value), `${label} must be an object`)
    requireCondition(
        Object.keys(value).sort().join('\0') === [...keys].sort().join('\0'),
        `${label} must contain exactly: ${keys.join(', ')}`
    )
}

// Only key ordering changes here. Unsupported JSON values fail rather than losing observations.
function canonicalize(value, path = '$', ancestors = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') {
        requireCondition(Number.isFinite(value) && !Object.is(value, -0), `Non-JSON number at ${path}`)
        return value
    }
    requireCondition(typeof value === 'object', `Non-JSON value at ${path}; encode it before serialization`)
    requireCondition(!ancestors.has(value), `Cyclic observation at ${path}`)
    ancestors.add(value)
    let result
    if (Array.isArray(value)) {
        requireCondition(
            Object.getOwnPropertyNames(value).length === value.length + 1 &&
                Object.getOwnPropertySymbols(value).length === 0,
            `Sparse or extended array at ${path}`
        )
        for (let index = 0; index < value.length; index++) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
            requireCondition(
                descriptor?.enumerable && Object.hasOwn(descriptor, 'value'),
                `Non-JSON array property at ${path}[${index}]`
            )
        }
        result = Array.from(value, (item, index) => canonicalize(item, `${path}[${index}]`, ancestors))
    } else {
        requireCondition(
            Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
            `Non-plain object at ${path}`
        )
        requireCondition(Object.getOwnPropertySymbols(value).length === 0, `Symbol key at ${path}`)
        result = Object.create(null)
        for (const key of Object.getOwnPropertyNames(value).sort()) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key)
            requireCondition(
                descriptor.enumerable && Object.hasOwn(descriptor, 'value'),
                `Non-JSON property at ${path}`
            )
            result[key] = canonicalize(descriptor.value, childPath(path, key), ancestors)
        }
    }
    ancestors.delete(value)
    return result
}

function serialize(value) {
    return `${JSON.stringify(canonicalize(value), null, 4)}\n`
}

function childPath(path, key, array = false) {
    if (array) return `${path}[${key}]`
    return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

function differences(expected, actual, path = '$', output = []) {
    if (Object.is(expected, actual)) return output
    if (
        expected === null ||
        actual === null ||
        typeof expected !== 'object' ||
        typeof actual !== 'object' ||
        Array.isArray(expected) !== Array.isArray(actual)
    ) {
        output.push({ path, expected, actual })
        return output
    }
    const array = Array.isArray(expected)
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    keys.sort(array ? (a, b) => Number(a) - Number(b) : undefined)
    for (const key of keys) {
        const nextPath = childPath(path, key, array)
        if (!Object.hasOwn(expected, key)) {
            output.push({ path: nextPath, missing: 'expected', actual: actual[key] })
        } else if (!Object.hasOwn(actual, key)) {
            output.push({ path: nextPath, missing: 'actual', expected: expected[key] })
        } else {
            differences(expected[key], actual[key], nextPath, output)
        }
    }
    return output
}

function selectionFor(selection = {}) {
    requireCondition(isObject(selection), 'selection must be an object')
    requireCondition(
        Object.keys(selection).every((key) => dimensions.includes(key)),
        'Unknown selection dimension'
    )
    return Object.fromEntries(
        dimensions.map((dimension) => {
            const values = Object.hasOwn(selection, dimension) ? selection[dimension] : MATRIX[dimension]
            requireCondition(
                Array.isArray(values) &&
                    values.length > 0 &&
                    new Set(values).size === values.length &&
                    values.every((value) => MATRIX[dimension].includes(value)),
                `Invalid selection.${dimension}`
            )
            return [dimension, MATRIX[dimension].filter((value) => values.includes(value))]
        })
    )
}

function tuplesFor(selection) {
    return selection.coreFamilies.flatMap((coreFamily) =>
        selection.entrypoints.flatMap((entrypoint) =>
            selection.browsers.flatMap((browser) =>
                selection.scenarios.map((scenario) => ({ coreFamily, entrypoint, browser, scenario }))
            )
        )
    )
}

function tupleKey(tuple) {
    return tupleFields.map((field) => tuple[field]).join('/')
}

function validateCell(cell, label) {
    requireCondition(isObject(cell.observations), `${label}: observations must be an object`)
    canonicalize(cell.observations)
    for (const [path, errors] of [
        ['unexpectedNetwork', cell.observations.unexpectedNetwork],
        ['api.unhandled', cell.observations.api?.unhandled],
        ['network.errors', cell.observations.network?.errors],
        ['pageErrors', cell.observations.pageErrors],
    ]) {
        requireCondition(
            errors === undefined || (Array.isArray(errors) && errors.length === 0),
            `${label}: unexpected runtime evidence at ${path}`
        )
    }
    requireCondition(
        cell.functionalCoverage === 'fully-ready' && cell.terminalOutcome === 'fully-ready',
        `${label}: expected fully-ready coverage and terminal outcome`
    )
    requireCondition(
        !Object.hasOwn(cell.observations, 'terminalOutcome') || cell.observations.terminalOutcome === 'fully-ready',
        `${label}: conflicting observation terminal outcome`
    )
}

function validateIntegrity(proof) {
    const groups = ['source', 'artifacts', 'runtime', 'browserTooling', 'historicalPackages']
    sameKeys(proof, ['expected', 'before', 'after'], 'inputIntegrity')
    for (const phase of ['expected', 'before', 'after']) {
        const inventory = proof[phase]
        sameKeys(inventory, groups, `inputIntegrity.${phase}`)
        sameKeys(
            inventory.historicalPackages,
            Object.keys(HISTORICAL_PACKAGES),
            `inputIntegrity.${phase}.historicalPackages`
        )
        for (const [role, pinned] of Object.entries(HISTORICAL_PACKAGES))
            requireCondition(
                inventory.historicalPackages[role] === pinned.integrity,
                `${phase}: ${role} integrity mismatch`
            )
        for (const group of groups.filter((key) => key !== 'historicalPackages')) {
            requireCondition(
                isObject(inventory[group]) &&
                    Object.keys(inventory[group]).length > 0 &&
                    Object.values(inventory[group]).every(
                        (digest) => typeof digest === 'string' && /^sha256-[a-f0-9]{64}$/.test(digest)
                    ),
                `inputIntegrity.${phase}.${group} must be a nonempty SHA-256 inventory`
            )
        }
    }
    requireCondition(
        serialize(proof.expected) === serialize(proof.before) && serialize(proof.before) === serialize(proof.after),
        'Input integrity changed or does not match the expected inventory'
    )
}

/**
 * Runner input: { repeats, selection?, inputIntegrity, runs }.
 * Each run has { coreFamily, entrypoint, browser, scenario, repeat (zero-based),
 * status: 'passed', assertionsPassed: true, runtimeErrors: [], functionalCoverage,
 * terminalOutcome, observations }. observations are already normalized, JSON-safe
 * values; explicit sentinels retain undefined/error semantics.
 *
 * inputIntegrity = { expected, before, after }; each inventory has nonempty maps of
 * identifier -> 'sha256-<64 lowercase hex>' under source, artifacts, runtime and
 * browserTooling, plus historicalPackages mapping both source roles to their pinned
 * SHA-512 integrity values. The runner must
 * hash/verify ALL source (including dirty changes), prepared bytes, harness/fixture/
 * normalizer inputs and pinned browser/tooling inputs, not just manifest labels.
 * Inventory membership and fingerprints must match in all three phases. Proof and
 * raw assertion/error/provenance evidence stay in run artifacts, not expected files.
 *
 * Omitted selection dimensions mean all values. Every selected tuple needs exactly
 * repeats runs (at least two), successful independent assertions and equal results.
 * Returns { coverage: 'full'|'partial', cellCount, functionalCoverage, repeats, files };
 * files maps stable deployment filenames to readable JSON strings. Full means tuple
 * completeness with fully-ready functional coverage. A partial set cannot be updated.
 */
export function buildGoldens(input) {
    requireCondition(isObject(input), 'Run input must be an object')
    requireCondition(Number.isSafeInteger(input.repeats) && input.repeats >= 2, 'At least two repetitions are required')
    validateIntegrity(input.inputIntegrity)
    const selection = selectionFor(input.selection)
    const tuples = tuplesFor(selection)
    const expectedKeys = new Set(tuples.map(tupleKey))
    requireCondition(Array.isArray(input.runs), 'runs must be an array')
    const runs = new Map()
    for (const run of input.runs) {
        requireCondition(isObject(run), 'Each run must be an object')
        const key = tupleKey(run)
        requireCondition(
            tupleFields.every((field, index) => selection[dimensions[index]].includes(run[field])) &&
                expectedKeys.has(key),
            `Unexpected tuple: ${key}`
        )
        requireCondition(
            Number.isSafeInteger(run.repeat) && run.repeat >= 0 && run.repeat < input.repeats,
            `${key}: invalid repeat ${run.repeat}`
        )
        const runKey = `${key}/${run.repeat}`
        requireCondition(!runs.has(runKey), `Duplicate run: ${runKey}`)
        requireCondition(
            run.status === 'passed' && run.assertionsPassed === true,
            `${runKey}: independent assertions or run failed`
        )
        requireCondition(
            Array.isArray(run.runtimeErrors) && run.runtimeErrors.length === 0,
            `${runKey}: unexpected runtime errors`
        )
        requireCondition(!Object.hasOwn(run, 'initializationError'), `${runKey}: unexpected initialization error`)
        validateCell(run, runKey)
        const cell = {
            functionalCoverage: run.functionalCoverage,
            terminalOutcome: run.terminalOutcome,
            observations: run.observations,
        }
        // Detach caller-owned data and compare the exact representation that will be stored.
        runs.set(runKey, serialize(cell))
    }
    const deployments = Object.create(null)
    for (const tuple of tuples) {
        const key = tupleKey(tuple)
        const first = runs.get(`${key}/0`)
        for (let repeat = 0; repeat < input.repeats; repeat++) {
            const observed = runs.get(`${key}/${repeat}`)
            requireCondition(observed !== undefined, `Missing run: ${key}/${repeat}`)
            if (observed !== first) {
                const changes = differences(JSON.parse(first), JSON.parse(observed))
                const error = new Error(`${key}: repetitions differ (0 vs ${repeat}) at ${changes[0].path}`)
                error.differences = changes.map((change) => ({
                    deployment: deploymentFilename(tuple.coreFamily, tuple.entrypoint),
                    browser: tuple.browser,
                    scenario: tuple.scenario,
                    ...change,
                }))
                throw error
            }
        }
        const filename = deploymentFilename(tuple.coreFamily, tuple.entrypoint)
        deployments[filename] ??= {
            schema: 1,
            coreFamily: tuple.coreFamily,
            ...(tuple.coreFamily === 'historical'
                ? { coreVersion: HISTORICAL_PACKAGES[historicalSource(tuple.entrypoint)].version }
                : {}),
            entrypoint: tuple.entrypoint,
            browsers: {},
        }
        const browsers = deployments[filename].browsers
        browsers[tuple.browser] ??= {}
        browsers[tuple.browser][tuple.scenario] = JSON.parse(first)
    }
    return {
        coverage: dimensions.every((key) => selection[key].length === MATRIX[key].length) ? 'full' : 'partial',
        cellCount: tuples.length,
        functionalCoverage: { 'fully-ready': tuples.length },
        repeats: input.repeats,
        files: Object.fromEntries(
            Object.entries(deployments).map(([filename, deployment]) => [filename, serialize(deployment)])
        ),
    }
}

function validateEnvelope(deployment, coreFamily, entrypoint, filename) {
    sameKeys(
        deployment,
        ['schema', 'coreFamily', 'entrypoint', 'browsers', ...(coreFamily === 'historical' ? ['coreVersion'] : [])],
        filename
    )
    requireCondition(
        deployment.schema === 1 &&
            deployment.coreFamily === coreFamily &&
            deployment.entrypoint === entrypoint &&
            (coreFamily !== 'historical' ||
                deployment.coreVersion === HISTORICAL_PACKAGES[historicalSource(entrypoint)].version),
        `${filename}: invalid schema or deployment attribution`
    )
    requireCondition(isObject(deployment.browsers), `${filename}: browsers must be an object`)
}

function validateFullDeployment(deployment, coreFamily, entrypoint, filename) {
    validateEnvelope(deployment, coreFamily, entrypoint, filename)
    sameKeys(deployment.browsers, MATRIX.browsers, `${filename}.browsers`)
    for (const browser of MATRIX.browsers) {
        sameKeys(deployment.browsers[browser], MATRIX.scenarios, `${filename}/${browser}`)
        for (const scenario of MATRIX.scenarios) {
            const cell = deployment.browsers[browser][scenario]
            const label = `${filename}/${browser}/${scenario}`
            sameKeys(cell, ['functionalCoverage', 'terminalOutcome', 'observations'], label)
            validateCell(cell, label)
        }
    }
}

/** Read-only comparison. Differences include deployment, browser, scenario, JSON path
 * and expected/actual values; missing values carry a 'missing' side marker. Focused
 * checks inspect only selected cells and return coverage: 'partial', never full credit.
 * The caller must fail its check command when matched is false (or validation throws).
 */
export async function compareGoldens(directory, input) {
    const built = buildGoldens(input)
    const output = []
    for (const [deployment, text] of Object.entries(built.files)) {
        const actual = JSON.parse(text)
        let expected
        try {
            expected = JSON.parse(await fs.readFile(join(directory, deployment), 'utf8'))
        } catch (error) {
            if (error.code !== 'ENOENT') throw error
        }
        if (expected !== undefined) {
            validateEnvelope(expected, actual.coreFamily, actual.entrypoint, deployment)
            if (built.coverage === 'full') {
                validateFullDeployment(expected, actual.coreFamily, actual.entrypoint, deployment)
            }
        }
        for (const [browser, scenarios] of Object.entries(actual.browsers)) {
            for (const [scenario, cell] of Object.entries(scenarios)) {
                const expectedCell = expected?.browsers[browser]?.[scenario]
                const changes =
                    expectedCell === undefined
                        ? [{ path: '$', missing: 'expected', actual: cell }]
                        : differences(expectedCell, cell)
                for (const change of changes) output.push({ deployment, browser, scenario, ...change })
            }
        }
    }
    return {
        coverage: built.coverage,
        cellCount: built.cellCount,
        functionalCoverage: built.functionalCoverage,
        repeats: built.repeats,
        matched: output.length === 0,
        differenceCount: output.length,
        differences: output,
    }
}

async function existingDirectory(directory, fileSystem) {
    let stat
    try {
        stat = await fileSystem.lstat(directory)
    } catch (error) {
        if (error.code === 'ENOENT') return false
        throw error
    }
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), 'Golden target must be a dedicated directory')
    const entries = await fileSystem.readdir(directory)
    requireCondition(
        entries.sort().join('\0') === [...filenames].sort().join('\0'),
        'Existing golden directory must contain exactly the six deployment files'
    )
    for (const filename of filenames) {
        const entry = await fileSystem.lstat(join(directory, filename))
        requireCondition(entry.isFile() && !entry.isSymbolicLink(), `${filename}: expected a regular golden file`)
    }
    return true
}

/** Explicit full-matrix update. directory is dedicated to the six golden JSON files.
 * Stage and read back all files before a directory-level swap; rollback restores the
 * old set on publication failure. fileSystem is the fs/promises fault-injection seam.
 * Callers must serialize updates/readers. This is exception-safe, not a crash-atomic
 * filesystem transaction: the old directory is retained in the sibling transaction
 * until publication succeeds. If rollback itself fails, recoveryDirectory identifies
 * that intact old set; it is deliberately not deleted. Raw run evidence is untouched.
 */
export async function updateGoldens(directory, input, { fileSystem = fs } = {}) {
    const built = buildGoldens(input)
    requireCondition(built.coverage === 'full', 'Partial runs cannot update the six-file golden set')
    directory = resolve(directory)
    const existed = await existingDirectory(directory, fileSystem)
    await fileSystem.mkdir(dirname(directory), { recursive: true })
    const transaction = await fileSystem.mkdtemp(join(dirname(directory), `.${basename(directory)}-update-`))
    const staged = join(transaction, 'next')
    const previous = join(transaction, 'previous')
    let movedPrevious = false
    let published = false
    let retainRecovery = false
    let failure
    try {
        await fileSystem.mkdir(staged)
        for (const filename of filenames) {
            await fileSystem.writeFile(join(staged, filename), built.files[filename], { encoding: 'utf8', flag: 'wx' })
        }
        await existingDirectory(staged, fileSystem)
        for (const filename of filenames) {
            const text = await fileSystem.readFile(join(staged, filename), 'utf8')
            requireCondition(text === built.files[filename], `Staged write verification failed: ${filename}`)
            const deployment = JSON.parse(text)
            validateFullDeployment(deployment, deployment.coreFamily, deployment.entrypoint, filename)
        }
        if (existed) {
            await fileSystem.rename(directory, previous)
            movedPrevious = true
        }
        await fileSystem.rename(staged, directory)
        published = true
    } catch (error) {
        failure = error
        if (movedPrevious) {
            try {
                await fileSystem.rename(previous, directory)
            } catch (rollbackError) {
                retainRecovery = true
                failure = new AggregateError(
                    [error, rollbackError],
                    `Golden publication and rollback failed; recover ${previous} to ${directory}`
                )
                failure.recoveryDirectory = previous
                throw failure
            }
        }
        throw error
    } finally {
        if (!retainRecovery) {
            try {
                await fileSystem.rm(transaction, { recursive: true, force: true })
            } catch (cleanupError) {
                // Publication is already complete (or rolled back); do not label it a failed update.
                const warning = `Could not remove transaction ${transaction}: ${cleanupError.message}`
                if (failure) failure.cleanupWarning = warning
                else built.cleanupWarning = warning
            }
        }
    }
    return {
        coverage: built.coverage,
        cellCount: built.cellCount,
        functionalCoverage: built.functionalCoverage,
        repeats: built.repeats,
        updated: published,
        ...(built.cleanupWarning ? { cleanupWarning: built.cleanupWarning } : {}),
    }
}
