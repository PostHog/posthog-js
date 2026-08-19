// Local runner for the @posthog/mcp integration harness: builds the package,
// then runs the same four lanes CI runs and prints a summary.
//
//   pnpm test:mcp-harness            (from the repo root)
//
// Individual lanes (what CI runs, one per job):
//   pnpm --filter @posthog/mcp run test:integration:sdk-v1
//   pnpm --filter @posthog/mcp run test:integration:sdk-v2
//   pnpm --filter @posthog/mcp run test:integration:nest-v1
//   pnpm --filter @posthog/mcp run test:integration:nest-v2
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const PKG_DIR = fileURLToPath(new URL('..', import.meta.url)) // packages/mcp
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

// Resolve the package manager that invoked us, so `node run-all.mjs` also works.
const PM = process.env.npm_execpath
const pm = (args, cwd) =>
    PM
        ? spawnSync(process.execPath, [PM, ...args], { cwd, stdio: 'inherit' })
        : spawnSync('pnpm', [...args], { cwd, stdio: 'inherit' })

// Scoped build: only @posthog/core + @posthog/mcp, so an unrelated package's
// build breakage cannot take the harness down.
console.log('· building @posthog/mcp (turbo, scoped)')
const build = pm(['exec', 'turbo', 'run', 'build', '--filter=@posthog/mcp'], ROOT)
if (build.status !== 0) process.exit(build.status ?? 1)

const LANES = [
    ['sdk v1', 'test:integration:sdk-v1'],
    ['sdk v2', 'test:integration:sdk-v2'],
    ['nest mcp sdk v1', 'test:integration:nest-v1'],
    ['nest mcp sdk v2', 'test:integration:nest-v2'],
]

const outcomes = []
for (const [name, script] of LANES) {
    console.log(`\n━━ ${name} ━━`)
    const res = pm(['run', script], PKG_DIR)
    outcomes.push([name, res.status === 0])
}

console.log('\n━━ summary ━━')
for (const [name, ok] of outcomes) {
    console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}`)
}
process.exit(outcomes.every(([, ok]) => ok) ? 0 : 1)
