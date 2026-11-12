// Installs immutable local tarballs only; does not build or modify any SDK checkout.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const [output, electron, core, types, browserCommon] = process.argv.slice(2).map((value) => resolve(value))
if (!output || !electron || !core || !types || !browserCommon)
    throw new Error('Usage: prepare-consumer.mjs NEW_OUTPUT ELECTRON_TGZ CORE_TGZ TYPES_TGZ BROWSER_COMMON_TGZ')
mkdirSync(output)
const dependencies = {
    '@posthog/electron': `file:${electron}`,
    '@posthog/core': `file:${core}`,
    '@posthog/types': `file:${types}`,
    '@posthog/browser-common': `file:${browserCommon}`,
    electron: '42.4.0',
    esbuild: '0.25.12',
}
writeFileSync(
    join(output, 'package.json'),
    JSON.stringify(
        {
            private: true,
            dependencies,
            overrides: {
                '@posthog/core': '$@posthog/core',
                '@posthog/types': '$@posthog/types',
                '@posthog/browser-common': '$@posthog/browser-common',
            },
        },
        null,
        2
    )
)
const dependencyCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', `--before=${dependencyCutoff}`], {
    cwd: output,
    stdio: 'inherit',
})
const require = createRequire(join(output, 'package.json'))
execFileSync(process.execPath, [require.resolve('electron/install.js')], { cwd: output, stdio: 'inherit' })
const sdk = createRequire(require.resolve('@posthog/electron/main'))
const installedCore = createRequire(require.resolve('@posthog/core'))
const installedBrowserCommon = createRequire(require.resolve('@posthog/browser-common'))
const installedRenderer = createRequire(require.resolve('@posthog/electron/renderer'))
if (
    realpathSync(installedRenderer.resolve('@posthog/browser-common/autocapture')) !==
        realpathSync(require.resolve('@posthog/browser-common/autocapture')) ||
    realpathSync(installedBrowserCommon.resolve('@posthog/core')) !== realpathSync(require.resolve('@posthog/core')) ||
    realpathSync(installedBrowserCommon.resolve('@posthog/types')) !==
        realpathSync(require.resolve('@posthog/types')) ||
    realpathSync(sdk.resolve('@posthog/core')) !== realpathSync(require.resolve('@posthog/core')) ||
    realpathSync(installedCore.resolve('@posthog/types')) !== realpathSync(require.resolve('@posthog/types'))
)
    throw new Error('Transitive package closure mismatch')
const lock = JSON.parse(readFileSync(join(output, 'package-lock.json')))
const packages = Object.entries(dependencies)
    .filter(([name]) => name.startsWith('@posthog/'))
    .map(([name, path]) => {
        const installed = lock.packages[`node_modules/${name}`]
        if (
            !installed.resolved.startsWith('file:') ||
            realpathSync(resolve(output, installed.resolved.slice(5))) !== realpathSync(path.slice(5))
        )
            throw new Error(`Not installed tarball: ${name}`)
        return {
            name,
            version: installed.version,
            tarball: path.slice(5),
            sha256: createHash('sha256')
                .update(readFileSync(path.slice(5)))
                .digest('hex'),
        }
    })
const page = join(output, 'acceptance-renderer')
mkdirSync(page)
writeFileSync(
    join(page, 'entry.mjs'),
    `import { init } from '@posthog/electron/renderer';\nimport { Binding } from ${JSON.stringify(fileURLToPath(new URL('./binding.mjs', import.meta.url)))};\nglobalThis.acceptance = new Binding(() => init(), 'electron-renderer');\n`
)
await require('esbuild').build({
    entryPoints: [join(page, 'entry.mjs')],
    outfile: join(page, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome148',
})
writeFileSync(
    join(page, 'index.html'),
    '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'"><script src="renderer.js"></script>'
)
writeFileSync(
    join(output, 'build.json'),
    JSON.stringify(
        {
            dependency_cutoff: dependencyCutoff,
            minimum_dependency_age_days: 7,
            source_revision: process.env.SOURCE_REVISION ?? null,
            packages,
            electron: '42.4.0',
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            fresh_dependency_closure: true,
            renderer_binding_sha256: createHash('sha256')
                .update(readFileSync(new URL('./binding.mjs', import.meta.url)))
                .digest('hex'),
        },
        null,
        2
    ) + '\n'
)
