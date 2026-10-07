/* eslint-disable no-console -- Standalone browser test fixtures exercise public APIs without importing SDK runtime helpers. */
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseOptions, selection } from './options.mjs'
import { MATRIX } from './golden.mjs'
import { prepare, directory, repository, execute } from './prepare.mjs'

const operation = process.argv[2]
if (!['check', 'update', 'validate'].includes(operation)) throw new Error('Expected check, update or validate')
const args = parseOptions(process.argv.slice(3), ['engines', 'modes', 'comparisons', 'scenarios', 'repeats', 'output'])
const selected = {
    engines: selection(MATRIX.browsers, args.engines, 'engines'),
    modes: selection(MATRIX.entrypoints, args.modes, 'modes'),
    comparisons: selection(['current', 'historical'], args.comparisons, 'comparisons'),
    scenarios: selection(MATRIX.scenarios, args.scenarios, 'scenarios'),
}
if (
    operation === 'update' &&
    (selected.engines.length !== 3 ||
        selected.modes.length !== 3 ||
        selected.comparisons.length !== 2 ||
        selected.scenarios.length !== 17)
)
    throw new Error('Updates require the full matrix')
if (args.repeats && (!Number.isInteger(Number(args.repeats)) || Number(args.repeats) < 2))
    throw new Error('At least two repetitions are required')
const output = resolve(
    args.output ?? join(repository, 'test-results/compatibility', new Date().toISOString().replace(/[:.]/g, '-'))
)
mkdirSync(dirname(output), { recursive: true })
mkdirSync(output, { recursive: false })
console.log(`Compatibility evidence: ${output}`)
console.log(
    execute('pnpm', ['turbo', 'run', 'build', '--filter=posthog-js', '--filter=@posthog-tooling/sdk-mock-server'])
)
await prepare(join(output, 'artifacts'))
const forwarded = Object.entries(args)
    .filter(([key]) => key !== 'output')
    .flatMap(([key, value]) => [`--${key}`, value])
const child = spawnSync(
    process.execPath,
    [
        join(directory, 'run.mjs'),
        '--manifest',
        join(output, 'artifacts/manifest.json'),
        '--output',
        join(output, 'runs'),
        '--operation',
        operation,
        ...forwarded,
    ],
    { stdio: 'inherit' }
)
if (child.error) throw child.error
process.exitCode = child.status ?? 1
