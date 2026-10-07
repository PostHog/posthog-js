import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import {
    mkdirSync,
    readFileSync,
    writeFileSync,
    readdirSync,
    realpathSync,
    statSync,
    existsSync,
    copyFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HISTORICAL_INTEGRITY } from './golden.mjs'

export const directory = dirname(fileURLToPath(import.meta.url))
export const repository = resolve(directory, '../../../..')
export const digest = (path) => 'sha256-' + createHash('sha256').update(readFileSync(path)).digest('hex')
export const execute = (command, args, cwd = repository) =>
    execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
export function inventoryTree(root, label, output = {}, visited = new Set()) {
    const physical = realpathSync(root)
    if (visited.has(physical)) return output
    visited.add(physical)
    for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(root, entry.name),
            key = `${label}/${entry.name}`
        if (entry.isDirectory()) inventoryTree(path, key, output, visited)
        else if (entry.isFile()) output[key] = digest(path)
        else if (entry.isSymbolicLink()) {
            const target = realpathSync(path)
            if (statSync(target).isDirectory()) inventoryTree(target, key, output, visited)
            else output[key] = digest(target)
        }
    }
    return output
}
export function sourceInventory() {
    const paths = execute('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
        .split('\0')
        .filter(Boolean)
        .filter(
            (path) =>
                !path.startsWith('packages/browser/playwright/compatibility/goldens/') &&
                existsSync(join(repository, path))
        )
    return Object.fromEntries(paths.sort().map((path) => [path, digest(join(repository, path))]))
}

export function inputInventory(manifest) {
    const artifacts = {}
    for (const [role, source] of Object.entries(manifest.sources)) {
        inventoryTree(source.sdk, `${role}/sdk`, artifacts)
        inventoryTree(source.dist, `${role}/cdn`, artifacts)
        for (const [name, input] of Object.entries(source.fixtures))
            artifacts[`${role}/${name}.js`] = digest(input.path)
        for (const [name, input] of Object.entries(source.packs ?? {})) artifacts[`${role}/${name}.tgz`] = digest(input)
        artifacts[`${role}/consumer-lock`] = digest(source.consumerLock)
        artifacts[`${role}/consumer-manifest`] = digest(join(source.consumer, 'package.json'))
        artifacts[`${role}/consumer-policy`] = digest(join(source.consumer, 'pnpm-workspace.yaml'))
        // Runtime dependencies are part of the isolated consumer, not workspace links.
        inventoryTree(join(source.consumer, 'node_modules'), `${role}/consumer-dependencies`, artifacts)
    }
    artifacts.player = digest(manifest.player.path)
    artifacts.historicalTarball = digest(manifest.historicalTarball)
    const runtime = inventoryTree(directory, 'compatibility')
    for (const name of Object.keys(runtime)) if (name.startsWith('compatibility/goldens/')) delete runtime[name]
    inventoryTree(join(repository, 'tooling/sdk-mock-server/dist'), 'sdk-mock-server/dist', runtime)
    const require = createRequire(join(repository, 'packages/browser/package.json'))
    const browserTooling = {}
    for (const name of ['@playwright/test', 'playwright', 'playwright-core', 'esbuild']) {
        const testRequire = createRequire(require.resolve('@playwright/test/package.json'))
        const resolver =
            name === 'playwright-core'
                ? createRequire(testRequire.resolve('playwright/package.json'))
                : name === 'playwright'
                  ? testRequire
                  : require
        const root = dirname(realpathSync(resolver.resolve(`${name}/package.json`)))
        inventoryTree(root, name, browserTooling)
    }
    const testRequire = createRequire(require.resolve('@playwright/test/package.json'))
    const coreRequire = createRequire(testRequire.resolve('playwright/package.json'))
    const coreRoot = dirname(coreRequire.resolve('playwright-core/package.json'))
    const { registry } = require(join(coreRoot, 'lib/server/registry/index.js'))
    for (const engine of ['chromium', 'chromium-headless-shell', 'firefox', 'webkit', 'ffmpeg'])
        inventoryTree(registry.findExecutable(engine).directory, `browser/${engine}`, browserTooling)
    const esbuildRequire = createRequire(require.resolve('esbuild/package.json'))
    inventoryTree(
        dirname(esbuildRequire.resolve(`@esbuild/${process.platform}-${process.arch}/package.json`)),
        'esbuild-native',
        browserTooling
    )
    browserTooling.node = digest(process.execPath)
    return { source: sourceInventory(), artifacts, runtime, browserTooling, historicalPackage: HISTORICAL_INTEGRITY }
}

export function verifyInputs(manifest) {
    const actual = inputInventory(manifest)
    for (const category of ['source', 'artifacts', 'runtime', 'browserTooling']) {
        const expected = manifest.inputIntegrity[category]
        for (const key of new Set([...Object.keys(expected), ...Object.keys(actual[category])])) {
            if (actual[category][key] !== expected[key]) throw new Error(`Input changed: ${category}/${key}`)
        }
    }
    const integrity = 'sha512-' + createHash('sha512').update(readFileSync(manifest.historicalTarball)).digest('base64')
    if (integrity !== HISTORICAL_INTEGRITY) throw new Error('Historical package integrity changed')
    return actual
}

export async function prepare(data) {
    mkdirSync(data, { recursive: false })
    const before = sourceInventory()
    const require = createRequire(join(repository, 'packages/browser/package.json'))
    const { buildSync } = require('esbuild')
    const sdkManifest = JSON.parse(readFileSync(join(repository, 'packages/browser/package.json')))
    const overrides = {}
    for (const name of Object.keys(sdkManifest.dependencies).filter((name) => !name.startsWith('@posthog/'))) {
        let packageRoot = dirname(require.resolve(name))
        while (!existsSync(join(packageRoot, 'package.json'))) packageRoot = dirname(packageRoot)
        const version = JSON.parse(readFileSync(join(packageRoot, 'package.json'))).version
        overrides[name] = sdkManifest.dependencies[name].startsWith('npm:')
            ? `npm:${sdkManifest.dependencies[name].slice(4).split('@')[0]}@${version}`
            : version
    }
    const dompurifyRequire = createRequire(require.resolve('dompurify'))
    overrides['@types/trusted-types'] = JSON.parse(
        readFileSync(dompurifyRequire.resolve('@types/trusted-types/package.json'))
    ).version
    const sources = {}
    const metadata = await (
        await fetch('https://registry.npmjs.org/posthog-js/1.354.0', { signal: AbortSignal.timeout(30000) })
    ).json()
    if (metadata.version !== '1.354.0' || metadata.dist.integrity !== HISTORICAL_INTEGRITY)
        throw new Error('Historical registry manifest changed')
    const bytes = Buffer.from(
        await (await fetch(metadata.dist.tarball, { signal: AbortSignal.timeout(30000) })).arrayBuffer()
    )
    if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== HISTORICAL_INTEGRITY)
        throw new Error('Historical tarball integrity mismatch')
    const historicalTarball = join(data, 'historical.tgz')
    writeFileSync(historicalTarball, bytes)
    for (const role of ['candidate', 'historical']) {
        const root = join(data, role),
            consumer = join(root, 'consumer')
        mkdirSync(consumer, { recursive: true })
        const packs = {}
        if (role === 'candidate') {
            for (const pkg of ['core', 'types', 'browser-common', 'browser']) {
                packs[pkg] = join(root, `${pkg}.tgz`)
                execute('pnpm', ['pack', '--out', packs[pkg]], join(repository, 'packages', pkg))
            }
        }
        const dependencies =
            role === 'candidate'
                ? {
                      'posthog-js': `file:${packs.browser}`,
                      '@posthog/core': `file:${packs.core}`,
                      '@posthog/types': `file:${packs.types}`,
                      '@posthog/browser-common': `file:${packs['browser-common']}`,
                  }
                : { 'posthog-js': 'file:../../historical.tgz' }
        writeFileSync(
            join(consumer, 'package.json'),
            JSON.stringify(
                {
                    name: `compat-${role}`,
                    version: '0.0.0',
                    private: true,
                    packageManager: 'pnpm@11.7.0',
                    dependencies,
                },
                null,
                2
            )
        )
        const consumerOverrides =
            role === 'candidate'
                ? {
                      ...overrides,
                      ...Object.fromEntries(
                          Object.entries(dependencies).filter(([name]) => name.startsWith('@posthog/'))
                      ),
                  }
                : Object.fromEntries(
                      Object.entries(metadata.dependencies).map(([name, version]) => [
                          name,
                          version.replace(/^[~^]/, ''),
                      ])
                  )
        writeFileSync(
            join(consumer, 'pnpm-workspace.yaml'),
            `minimumReleaseAge: 10080\noverrides:\n${Object.entries(consumerOverrides)
                .map(([key, version]) => `  '${key}': '${version}'`)
                .join('\n')}\n`
        )
        if (role === 'historical')
            copyFileSync(join(directory, 'fixtures/historical-pnpm-lock.yaml'), join(consumer, 'pnpm-lock.yaml'))
        execute(
            'pnpm',
            ['install', '--ignore-scripts', ...(role === 'historical' ? ['--frozen-lockfile'] : [])],
            consumer
        )
        if (execute('pnpm', ['config', 'get', 'minimumReleaseAge'], consumer).trim() !== '10080')
            throw new Error('Consumer dependency cooldown changed')
        const sdk = realpathSync(join(consumer, 'node_modules/posthog-js')),
            manifest = JSON.parse(readFileSync(join(sdk, 'package.json')))
        if (manifest.version !== (role === 'candidate' ? sdkManifest.version : '1.354.0'))
            throw new Error('Installed core version changed')
        const dist = join(sdk, 'dist')
        const files = Object.fromEntries(
            readdirSync(dist)
                .filter((file) => /\.(js|mjs)$/.test(file))
                .sort()
                .map((file) => [file, digest(join(dist, file))])
        )
        for (const file of ['array.js', 'module.slim.js'])
            if (!files[file]) throw new Error(`Missing production asset ${file}`)
        const publicSlim = manifest.exports?.['./slim'] ? 'posthog-js/slim' : 'posthog-js/dist/module.slim.js'
        const publicExtensions = manifest.exports?.['./extensions']
            ? 'posthog-js/extensions'
            : 'posthog-js/dist/extension-bundles.js'
        const fixtures = {}
        for (const mode of ['npm', 'slim']) {
            const outfile = join(data, `${role}-${mode}.js`)
            buildSync({
                stdin: {
                    contents: `import ph from ${JSON.stringify(mode === 'slim' ? publicSlim : 'posthog-js')};\n${mode === 'slim' ? `import { AllExtensions } from ${JSON.stringify(publicExtensions)};` : 'const AllExtensions = undefined;'}\nwindow.__compatInstall(ph, AllExtensions);`,
                    resolveDir: consumer,
                    sourcefile: 'consumer.js',
                },
                bundle: true,
                platform: 'browser',
                format: 'iife',
                target: 'es2020',
                outfile,
                logLevel: 'silent',
            })
            fixtures[mode] = {
                path: outfile,
                import: mode === 'slim' ? publicSlim : 'posthog-js',
                ...(mode === 'slim' ? { extensions: publicExtensions } : {}),
            }
        }
        sources[role] = {
            sdk,
            dist,
            consumer,
            version: manifest.version,
            files,
            fixtures,
            packs,
            consumerLock: join(consumer, 'pnpm-lock.yaml'),
        }
    }
    const player = { path: join(data, 'player.js') }
    buildSync({
        stdin: {
            contents: "import { Replayer } from 'posthog-js/rrweb'; window.__CompatReplayer = Replayer;",
            resolveDir: join(data, 'candidate/consumer'),
            sourcefile: 'player.js',
        },
        bundle: true,
        platform: 'browser',
        format: 'iife',
        target: 'es2020',
        outfile: player.path,
        logLevel: 'silent',
    })
    const manifest = {
        schema: 1,
        sources,
        player,
        snippet: { path: join(directory, 'snippet.js') },
        historicalTarball,
        provenance: {
            head: execute('git', ['rev-parse', 'HEAD']).trim(),
            workingTree: execute('git', ['status', '--short']).trim(),
            platform: process.platform,
            node: process.version,
        },
    }
    manifest.inputIntegrity = inputInventory(manifest)
    if (JSON.stringify(before) !== JSON.stringify(manifest.inputIntegrity.source))
        throw new Error('Source changed during preparation')
    writeFileSync(join(data, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    return manifest
}
