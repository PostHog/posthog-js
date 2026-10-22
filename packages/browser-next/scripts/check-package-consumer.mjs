import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
    copyFileSync,
    existsSync,
    globSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createMockServer } from '../../../tooling/sdk-mock-server/dist/index.js'

// Run after the browser and mock server builds. Retain tarballs, installs and logs for diagnosis.
const root = path.resolve(import.meta.dirname, '../../..')
const consumer = mkdtempSync(path.join(tmpdir(), 'browser-package-consumer-'))
const tarballs = path.join(consumer, 'tarballs')
mkdirSync(tarballs)
process.stdout.write(`Package consumer evidence: ${consumer}\n`)
const rootManifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const packages = new Map(
    globSync('packages/*/package.json', { cwd: root }).map((file) => {
        const manifest = JSON.parse(readFileSync(path.join(root, file), 'utf8'))
        return [manifest.name, { manifest, directory: path.join(root, path.dirname(file)) }]
    })
)
const dependencies = {}
const runtimeSections = ['dependencies', 'optionalDependencies', 'peerDependencies']

function run(command, args, cwd, log) {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, PREK: '0', HUSKY: '0' },
    })
    writeFileSync(path.join(consumer, log), (result.stdout ?? '') + (result.stderr ?? ''))
    assert.equal(result.status, 0, `${command} ${args.join(' ')} failed: see ${path.join(consumer, log)}`)
    return result.stdout
}

function pack(name) {
    if (dependencies[name]) return
    const { manifest, directory } = packages.get(name)
    assert.notEqual(manifest.private, true, `Private runtime dependency: ${name}`)
    const filename = `${name.replace('@', '').replace('/', '-')}.tgz`
    const tarball = path.join(tarballs, filename)
    run('pnpm', ['pack', '--out', tarball], directory, `pack-${filename}.log`)
    dependencies[name] = `file:./tarballs/${filename}`
    const packed = JSON.parse(run('tar', ['-xOf', tarball, 'package/package.json'], root, `manifest-${filename}.log`))
    for (const section of runtimeSections) {
        for (const [dependency, version] of Object.entries(manifest[section] ?? {})) {
            assert.ok(
                !/^(workspace|catalog|link|file):/.test(packed[section][dependency]),
                `Unresolved ${section}: ${dependency}`
            )
            if (packages.has(dependency)) {
                const target = packages.get(dependency).manifest
                assert.notEqual(target.private, true, `Private runtime dependency: ${dependency}`)
                if (version.startsWith('workspace:')) {
                    assert.equal(
                        packed[section][dependency],
                        version.replace('workspace:', '').replace('*', '') + target.version
                    )
                }
                pack(dependency)
            }
        }
    }
    if (name !== '@posthog/browser') return
    const inventory = run('tar', ['-tzf', tarball], root, 'browser-tarball-inventory.log').trim().split('\n')
    assert.ok(inventory.includes('package/LICENSE'), 'Public package must include LICENSE')
    assert.equal(
        run('tar', ['-xOf', tarball, 'package/LICENSE'], root, 'browser-license.log'),
        readFileSync(path.join(root, 'LICENSE'), 'utf8')
    )
    for (const file of inventory) {
        assert.match(file, /^package\/(dist\/|package\.json$|README\.md$|ARCHITECTURE\.md$|CHANGELOG\.md$|LICENSE$)/)
        assert.doesNotMatch(file, /(?:^|\/)(?:dist-cdn|snippet)(?:[./-]|$)/, `CDN-only file in npm package: ${file}`)
    }
    assert.equal(packed.sideEffects, false)
    for (const [entry, conditions] of Object.entries(packed.exports)) {
        for (const condition of ['types', 'import', 'require']) {
            assert.ok(
                inventory.includes(`package/${conditions[condition].replace(/^\.\//, '')}`),
                `${entry} ${condition} missing from tarball`
            )
        }
    }
    process.stdout.write(
        `Tarball: ${inventory.length} files; LICENSE and every export target present; CDN/snippet files excluded\n`
    )
}

pack('@posthog/browser')
run(process.execPath, [path.join(root, 'scripts/check-package-tarballs.js'), tarballs], root, 'tarball-graphs.log')
writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
        {
            private: true,
            packageManager: rootManifest.packageManager,
            dependencies,
        },
        null,
        2
    )
)
writeFileSync(
    path.join(consumer, 'pnpm-workspace.yaml'),
    `minimumReleaseAge: 10080\noverrides: ${JSON.stringify(dependencies)}\n`
)
assert.equal(run('pnpm', ['--version'], consumer, 'pnpm-version.log').trim(), rootManifest.packageManager.split('@')[1])
assert.equal(run('pnpm', ['config', 'get', 'minimumReleaseAge'], consumer, 'cooldown.log').trim(), '10080')
run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], consumer, 'consumer-lock.log')
run('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], consumer, 'consumer-install.log')
for (const name of Object.keys(dependencies)) {
    const installed = realpathSync(path.join(consumer, 'node_modules', name))
    assert.ok(
        installed.startsWith(realpathSync(consumer) + path.sep),
        `${name} resolved outside the installed consumer`
    )
    const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
    for (const section of runtimeSections) {
        for (const dependency of Object.keys(manifest[section] ?? {})) {
            assert.ok(!dependency.startsWith('@posthog-tooling/'), `Private tooling leaked into ${name}`)
        }
    }
}
assert.ok(!existsSync(path.join(consumer, 'node_modules/@posthog-tooling')))

const declarations = `
import { createPostHog, FeatureFlagsExtension, type PostHog, type Extension } from '@posthog/browser'
import { createPostHog as createCore } from '@posthog/browser/core'
import { analytics } from '@posthog/browser/analytics'
import { flags } from '@posthog/browser/flags'
import { logs } from '@posthog/browser/logs'
import { surveys } from '@posthog/browser/surveys'
import { autocapture } from '@posthog/browser/autocapture'
const extensions: Extension[] = [analytics(), flags(), logs(), surveys(), autocapture()]
async function consume(): Promise<PostHog> {
    const client = await createPostHog({ projectToken: 'phc_types', extensions })
    client.getExtension(FeatureFlagsExtension)?.getFeatureFlag('example')
    await client.captureImmediate('typed-event')
    const core: PostHog = await createCore({ projectToken: 'phc_types', extensions })
    await core.dispose()
    return client
}
void consume
`
for (const extension of ['mts', 'cts']) writeFileSync(path.join(consumer, `consumer.${extension}`), declarations)
writeFileSync(
    path.join(consumer, 'tsconfig.json'),
    JSON.stringify({
        compilerOptions: {
            strict: true,
            skipLibCheck: false,
            noEmit: true,
            target: 'ES2023',
            module: 'Node16',
            moduleResolution: 'Node16',
            lib: ['ES2023', 'DOM', 'DOM.Iterable'],
            types: [],
        },
        include: ['consumer.mts', 'consumer.cts'],
    })
)
for (const compiler of ['typescript', 'typescript-legacy']) {
    run(
        process.execPath,
        [path.join(root, `packages/browser-next/node_modules/${compiler}/bin/tsc`), '-p', 'tsconfig.json'],
        consumer,
        `declarations-${compiler}.log`
    )
}
process.stdout.write('Strict installed ESM/CommonJS declarations passed (TypeScript 7 and 5.8, skipLibCheck=false)\n')

copyFileSync(
    path.join(root, 'packages/browser-next/fixtures/package-consumer.mjs'),
    path.join(consumer, 'consumer.mjs')
)
const mock = createMockServer({ state: { projectToken: 'phc_package_consumer', sessionReplayEnabled: false } })
const origin = await mock.start()
try {
    // Async subprocesses let this process continue serving local mock requests.
    const { spawn } = await import('node:child_process')
    for (const format of ['esm', 'cjs']) {
        await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ['consumer.mjs', format], {
                cwd: consumer,
                timeout: 60_000,
                env: { ...process.env, MOCK_ORIGIN: origin },
            })
            let output = ''
            child.stdout.on('data', (data) => {
                output += data
            })
            child.stderr.on('data', (data) => {
                output += data
            })
            child.on('error', reject)
            child.on('close', (code) => {
                writeFileSync(path.join(consumer, `${format}-runtime.log`), output)
                if (code === 0) {
                    process.stdout.write(output)
                    resolve()
                } else reject(new Error(`${format} consumer failed: see ${consumer}/${format}-runtime.log`))
            })
        })
    }
    const evidence = mock.inspect()
    writeFileSync(path.join(consumer, 'mock-evidence.json'), JSON.stringify(evidence, null, 2))
    const expected = ['esm', 'cjs'].flatMap((format) =>
        ['root', 'core'].flatMap((entry) =>
            ['queued', 'immediate'].map((kind) => `packaged_${format}_${entry}_${kind}`)
        )
    )
    assert.deepEqual(evidence.events.map((event) => event.event).sort(), expected.sort())
    assert.equal(evidence.requests.filter((request) => request.path === '/i/v1/analytics/events').length, 8)
    assert.deepEqual(evidence.errors, [])
    assert.deepEqual(evidence.blockedRequests, [])
    process.stdout.write(
        'All eight installed root/core ESM/CommonJS queued/immediate events delivered to local Capture V1 mock\n'
    )
} finally {
    await mock.stop()
}
