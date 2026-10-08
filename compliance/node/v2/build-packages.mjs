// Run from a disposable source tree: normal builds generate SDK package outputs.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const output = resolve(process.argv[2])
const source = process.cwd()
mkdirSync(output) // Refuse to reuse tarballs or an installed consumer.
const tarballs = join(output, 'tarballs')
const consumer = join(output, 'consumer')
mkdirSync(tarballs)
mkdirSync(consumer)
const run = (command, args, cwd = source) => execFileSync(command, args, { cwd, stdio: 'inherit' })
const packages = { 'posthog-node': 'node', '@posthog/core': 'core', '@posthog/types': 'types' }
for (const directory of Object.values(packages))
    rmSync(join(source, 'packages', directory, 'dist'), { recursive: true, force: true })
run('pnpm', ['turbo', 'run', 'build', '--filter=posthog-node', '--force'])
const dependencies = {}
const identity = []
for (const [name, directory] of Object.entries(packages)) {
    const filename = `${directory}.tgz`
    run('pnpm', ['pack', '--out', join(tarballs, filename)], join(source, 'packages', directory))
    dependencies[name] = `file:../tarballs/${filename}`
    const { version } = JSON.parse(readFileSync(join(source, 'packages', directory, 'package.json')))
    identity.push({
        name,
        version,
        sha256: createHash('sha256')
            .update(readFileSync(join(tarballs, filename)))
            .digest('hex'),
    })
}
writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify(
        {
            private: true,
            dependencies,
            overrides: { '@posthog/core': '$@posthog/core', '@posthog/types': '$@posthog/types' },
        },
        null,
        2
    )
)
run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], consumer)
run('npm', ['ls', '--all'], consumer)
const lock = JSON.parse(readFileSync(join(consumer, 'package-lock.json')))
for (const { name, version } of identity) {
    const installed = lock.packages[`node_modules/${name}`]
    if (installed.version !== version || installed.resolved !== dependencies[name])
        throw new Error(`Not the fresh tarball: ${name}`)
}
const require = createRequire(join(consumer, 'package.json'))
const sdkRequire = createRequire(require.resolve('posthog-node'))
const coreRequire = createRequire(require.resolve('@posthog/core'))
if (
    realpathSync(sdkRequire.resolve('@posthog/core')) !== realpathSync(require.resolve('@posthog/core')) ||
    realpathSync(coreRequire.resolve('@posthog/types')) !== realpathSync(require.resolve('@posthog/types'))
) {
    throw new Error('SDK dependency closure differs from fresh consumer packages')
}
// Native Node resolution selects the actual public exports, not a dist-file guess.
run(
    process.execPath,
    [
        '--input-type=module',
        '--experimental-import-meta-resolve',
        '--eval',
        `
    import assert from 'node:assert/strict'
    import { createRequire } from 'node:module'
    const require = createRequire(process.cwd() + '/package.json')
    assert.equal(typeof require('posthog-node').PostHog, 'function')
    assert.equal(typeof (await import('posthog-node')).PostHog, 'function')
    const sdk = import.meta.resolve('posthog-node')
    const core = import.meta.resolve('@posthog/core')
    assert.equal(import.meta.resolve('@posthog/core', sdk), core)
    assert.equal(import.meta.resolve('@posthog/types', core), import.meta.resolve('@posthog/types'))
`,
    ],
    consumer
)
writeFileSync(
    join(output, 'build.json'),
    JSON.stringify(
        {
            source_revision: process.env.SOURCE_REVISION ?? null,
            packages: identity,
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            public_cjs_esm: true,
            fresh_dependency_closure: true,
        },
        null,
        2
    ) + '\n'
)
