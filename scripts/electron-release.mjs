import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const registry = 'https://registry.npmjs.org'
export const packageName = '@posthog/electron'
const plainVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
// First-party core packages released from this repo, including their transitive
// @posthog/types, are exempt from the seven-day cooldown.
export const cooldownExempt = new Set(['@posthog/core', '@posthog/browser-common', '@posthog/types'])

export function validateManifest(manifest, version) {
    assert.match(version, plainVersion, 'Only exact x.y.z versions are permitted')
    assert.equal(manifest.name, packageName)
    assert.equal(manifest.version, version, 'Commit and requested version must match; no CI version rewriting')
    assert.ok(!manifest.private, 'Electron must be publishable')
    assert.equal(manifest.publishConfig?.tag, undefined, 'Use the shared release default npm tag')
    assert.ok(manifest.dependencies?.['@posthog/core'], 'Core must remain an external registry dependency')
    assert.ok(!manifest.bundledDependencies && !manifest.bundleDependencies, 'No bundled dependencies')
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
        assert.ok(
            range.startsWith('^') && plainVersion.test(range.slice(1)),
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
        if (cooldownExempt.has(name)) continue
        const released = Date.parse(dependency.time?.[minimum])
        assert.ok(
            Number.isFinite(released) && now - released >= 10080 * 60_000,
            `${name}@${minimum} must satisfy the seven-day cooldown`
        )
    }
}

export function unpack(tarball) {
    const directory = mkdtempSync(join(tmpdir(), 'electron-release-package-'))
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
    const directory = mkdtempSync(join(tmpdir(), 'electron-registry-consumer-'))
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
        [
            'packages: []',
            'minimumReleaseAge: 10080',
            'minimumReleaseAgeExclude:',
            ...[...cooldownExempt].map((name) => `  - '${name}'`),
            'autoInstallPeers: false',
            '',
        ].join('\n')
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
    const [tarball, version] = process.argv.slice(2)
    assert.ok(tarball && version, 'Usage: node scripts/electron-release.mjs <tarball> <version>')
    const { manifest } = unpack(tarball)
    await checkRegistry(manifest, version)
    registryConsumer(tarball, manifest)
    process.stdout.write(`${packageName}@${version}: registry consumer checks passed\n`)
    process.stdout.write(`SHA-256: ${createHash('sha256').update(readFileSync(tarball)).digest('hex')}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch((error) => {
        process.stderr.write(`${error.stack ?? error}\n`)
        process.exitCode = 1
    })
}
