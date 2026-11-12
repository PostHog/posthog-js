import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const registry = 'https://registry.npmjs.org'
export const packageName = '@posthog/electron'
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const alphaVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)$/

export function validateManifest(manifest, version) {
    assert.match(version, alphaVersion, 'Only exact alpha.N versions are permitted')
    assert.equal(manifest.name, packageName)
    assert.equal(manifest.version, version, 'Commit and requested version must match; no CI version rewriting')
    assert.ok(!manifest.private, 'Alpha must be publishable')
    assert.ok(manifest.dependencies?.['@posthog/core'], 'Core must remain an external registry dependency')
    assert.ok(!manifest.bundledDependencies && !manifest.bundleDependencies, 'No bundled dependencies')
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
        assert.ok(
            range.startsWith('^') && stableVersion.test(range.slice(1)),
            `${name}: require a packed ^stable lower bound`
        )
    }
}

export async function metadata(name, fetchMetadata = fetch) {
    const response = await fetchMetadata(`${registry}/${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(30_000),
    })
    // Only an explicit registry 404 is absence. Auth, rate limits and outages fail closed.
    if (response.status === 404) return null
    assert.ok(response.ok, `Registry lookup failed for ${name}: HTTP ${response.status}`)
    const data = await response.json()
    assert.equal(data.name, name, 'Registry metadata must identify the requested package')
    assert.ok(data.versions && typeof data.versions === 'object', 'Registry versions metadata is required')
    return data
}

export async function checkRegistry(manifest, version, fetchMetadata = fetch, now = Date.now()) {
    validateManifest(manifest, version)
    const target = await metadata(packageName, fetchMetadata)
    assert.ok(!target?.versions?.[version], `${packageName}@${version} already exists; choose a new reviewed version`)
    for (const [name, range] of Object.entries(manifest.dependencies)) {
        const minimum = range.slice(1)
        const dependency = await metadata(name, fetchMetadata)
        assert.ok(dependency?.versions?.[minimum], `${name}@${minimum} must be published first`)
        const released = Date.parse(dependency.time?.[minimum])
        assert.ok(
            Number.isFinite(released) && now - released >= 10080 * 60_000,
            `${name}@${minimum} must satisfy the seven-day cooldown`
        )
    }
}

function git(...args) {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

export function validateSource(sha, version) {
    assert.match(sha, /^[a-f0-9]{40}$/, 'A full immutable source SHA is required')
    assert.match(version, alphaVersion)
    assert.equal(git('rev-parse', `${sha}^{commit}`), sha)
    git('merge-base', '--is-ancestor', sha, 'origin/main')
    const manifest = JSON.parse(git('show', `${sha}:packages/electron/package.json`))
    assert.equal(manifest.name, packageName)
    assert.equal(manifest.version, version)
    const config = JSON.parse(git('show', `${sha}:.changeset/config.json`))
    assert.ok(config.ignore.includes(packageName), 'Source must isolate Electron from stable Changesets versioning')
    assert.equal(git('tag', '--list', `${packageName}@${version}`), '', 'Release tag must not already exist')
}

export function unpack(tarball) {
    const directory = mkdtempSync(join(tmpdir(), 'electron-alpha-package-'))
    execFileSync('tar', ['-xzf', resolve(tarball), '-C', directory])
    const manifest = JSON.parse(readFileSync(join(directory, 'package/package.json'), 'utf8'))
    return { directory, manifest }
}

export function assertCoreHooks(core) {
    for (const hook of ['getFlagsForContext', 'shouldRetainBatchOnError']) {
        assert.equal(typeof core.PostHogCore?.prototype[hook], 'function', `Published @posthog/core is missing ${hook}`)
    }
}

// This is deliberately independent of the repo's tarball-rewriting pnpmfile and
// local core overrides. Test the declared lower bounds, not a newer lucky resolution.
export function registryConsumer(tarball, manifest) {
    const directory = mkdtempSync(join(tmpdir(), 'electron-alpha-registry-consumer-'))
    process.stdout.write(`Registry-only consumer (retained for inspection): ${directory}\n`)
    const root = JSON.parse(readFileSync('package.json', 'utf8'))
    const electron = JSON.parse(readFileSync('packages/electron/package.json', 'utf8'))
    const nativeTypescript = '7.0.2'
    writeFileSync(
        join(directory, 'package.json'),
        JSON.stringify(
            {
                private: true,
                type: 'module',
                packageManager: root.packageManager,
                dependencies: {
                    [packageName]: `file:${resolve(tarball)}`,
                    ...Object.fromEntries(
                        Object.entries(manifest.dependencies).map(([name, range]) => [name, range.slice(1)])
                    ),
                    electron: electron.devDependencies.electron,
                    typescript: nativeTypescript,
                    '@types/node': root.devDependencies['@types/node'],
                    ...(manifest.exports['./react'] ? { react: '18.3.1', '@types/react': '18.3.18' } : {}),
                },
            },
            null,
            2
        )
    )
    writeFileSync(
        join(directory, 'pnpm-workspace.yaml'),
        'packages: []\nminimumReleaseAge: 10080\nautoInstallPeers: false\n'
    )
    const run = (...args) =>
        execFileSync('pnpm', args, {
            cwd: directory,
            stdio: 'inherit',
            env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
        })
    run('install', '--ignore-scripts', '--registry', registry)
    writeFileSync(
        join(directory, 'hooks.mjs'),
        `import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import * as core from '@posthog/core'
const require = createRequire(import.meta.url)
const fromElectron = createRequire(require.resolve('@posthog/electron/main'))
for (const name of ${JSON.stringify(Object.keys(manifest.dependencies))}) {
    assert.equal(realpathSync(fromElectron.resolve(name)), realpathSync(require.resolve(name)),
        name + ': Electron must resolve the tested lower bound, not a newer transitive copy')
}
(${assertCoreHooks.toString()})(core)
`
    )
    execFileSync(process.execPath, ['hooks.mjs'], { cwd: directory, stdio: 'inherit' })
    const imports = Object.keys(manifest.exports)
        .map((entry, index) => `import type * as Entry${index} from '${packageName}/${entry.slice(2)}'`)
        .join('\n')
    writeFileSync(join(directory, 'consumer.ts'), `${imports}\n`)
    run(
        'exec',
        'tsc',
        '--noEmit',
        '--strict',
        '--module',
        'nodenext',
        '--moduleResolution',
        'nodenext',
        '--target',
        'es2022',
        'consumer.ts'
    )
    return directory
}

async function main() {
    const [command, target, version] = process.argv.slice(2)
    if (command === 'source') {
        validateSource(target, version)
    } else if (command === 'package' || command === 'consumer') {
        const { manifest } = unpack(target)
        await checkRegistry(manifest, version)
        if (command === 'consumer') registryConsumer(target, manifest)
        process.stdout.write(`${packageName}@${version}: ${command} checks passed\n`)
        process.stdout.write(`SHA-256: ${createHash('sha256').update(readFileSync(target)).digest('hex')}\n`)
    } else {
        throw new Error(
            'Usage: node scripts/electron-alpha-release.mjs <source|package|consumer> <sha|tarball> <version>'
        )
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch((error) => {
        process.stderr.write(`${error.stack ?? error}\n`)
        process.exitCode = 1
    })
}
