#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import { build, version as esbuildVersion } from 'esbuild'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../../..')
const entrypoint = 'packages/browser/src/entrypoints/array.ts'
const snapshotPaths = [
    'packages/browser/src',
    'packages/browser/package.json',
    'packages/browser/tsconfig.json',
    'packages/browser-common/src',
    'packages/browser-common/package.json',
    'packages/browser-common/tsconfig.json',
    'packages/core/src',
    'packages/core/package.json',
    'packages/core/tsconfig.json',
    'packages/types/src',
    'packages/types/package.json',
    'packages/types/tsconfig.json',
]

function git(args, options = {}) {
    return execFileSync('git', args, {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options,
    }).trim()
}

function resolveRef(ref) {
    try {
        return git(['rev-parse', '--verify', `${ref}^{commit}`])
    } catch {
        return undefined
    }
}

function defaultBaseline() {
    for (const ref of ['origin/main', 'main']) {
        if (resolveRef(ref)) {
            return ref
        }
    }

    throw new Error('Could not find origin/main or main. Pass the baseline git ref explicitly.')
}

function workspaceAliases(sourceRoot) {
    return {
        '@posthog/browser-common': path.join(sourceRoot, 'packages/browser-common/src'),
        '@posthog/core': path.join(sourceRoot, 'packages/core/src'),
        '@posthog/types': path.join(sourceRoot, 'packages/types/src'),
    }
}

async function bundle(sourceRoot) {
    const browserPackagePath = await realpath(path.join(sourceRoot, 'packages/browser/package.json'))
    const result = await build({
        entryPoints: [path.join(sourceRoot, entrypoint)],
        alias: workspaceAliases(sourceRoot),
        bundle: true,
        format: 'iife',
        legalComments: 'none',
        logLevel: 'silent',
        minify: true,
        nodePaths: [
            path.join(repositoryRoot, 'packages/browser/node_modules'),
            path.join(repositoryRoot, 'node_modules'),
        ],
        platform: 'browser',
        plugins: [
            {
                name: 'browser-package-version-only',
                setup(esbuild) {
                    esbuild.onLoad({ filter: /package\.json$/ }, async ({ path: loadedPath }) => {
                        if (path.resolve(loadedPath) !== browserPackagePath) {
                            return undefined
                        }

                        const { version } = JSON.parse(await readFile(loadedPath, 'utf8'))
                        return { contents: JSON.stringify({ version }), loader: 'json' }
                    })
                },
            },
        ],
        target: 'es2015',
        write: false,
    })

    if (result.outputFiles.length !== 1) {
        throw new Error(`Expected one JavaScript bundle, received ${result.outputFiles.length} outputs.`)
    }

    return result.outputFiles[0].contents
}

function sizes(contents) {
    return {
        minified: contents.byteLength,
        gzip: gzipSync(contents, { level: 9 }).byteLength,
        brotli: brotliCompressSync(contents, {
            params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
            },
        }).byteLength,
    }
}

function formatSize(bytes) {
    return `${(bytes / 1024).toFixed(2)} KiB`
}

function formatChange(baseline, current) {
    const bytes = current - baseline
    const percentage = baseline === 0 ? 0 : (bytes / baseline) * 100
    const sign = bytes >= 0 ? '+' : '-'

    return `${sign}${formatSize(Math.abs(bytes))} (${sign}${Math.abs(percentage).toFixed(2)}%)`
}

function printTable(baseline, current) {
    const rows = [
        ['Minified', baseline.minified, current.minified],
        ['Gzip', baseline.gzip, current.gzip],
        ['Brotli', baseline.brotli, current.brotli],
    ].map(([label, baselineBytes, currentBytes]) => [
        label,
        formatSize(baselineBytes),
        formatSize(currentBytes),
        formatChange(baselineBytes, currentBytes),
    ])
    const headings = ['Size', 'Baseline', 'Current', 'Change']
    const widths = headings.map((heading, index) =>
        Math.max(heading.length, ...rows.map((row) => String(row[index]).length))
    )
    const printRow = (row) => row.map((value, index) => String(value).padEnd(widths[index])).join('  ')

    console.log(printRow(headings))
    console.log(widths.map((width) => '-'.repeat(width)).join('  '))
    for (const row of rows) {
        console.log(printRow(row))
    }
}

async function main() {
    const args = process.argv.slice(2)
    if (args.includes('--help') || args.includes('-h')) {
        console.log('Usage: pnpm bundle-size:array [baseline-ref]')
        console.log('Defaults to origin/main, then main.')
        return
    }
    if (args.length > 1) {
        throw new Error('Expected at most one baseline git ref. See --help for usage.')
    }

    const startedAt = performance.now()
    const baselineRef = args[0] ?? defaultBaseline()
    const baselineCommit = resolveRef(baselineRef)
    if (!baselineCommit) {
        throw new Error(`Could not resolve baseline ref: ${baselineRef}`)
    }

    const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'posthog-array-size-'))
    const snapshotRoot = path.join(temporaryRoot, 'baseline')
    const archivePath = path.join(temporaryRoot, 'baseline.tar')

    try {
        execFileSync(
            'git',
            ['archive', '--format=tar', `--output=${archivePath}`, baselineCommit, '--', ...snapshotPaths],
            { cwd: repositoryRoot, stdio: ['ignore', 'ignore', 'pipe'] }
        )
        await mkdir(snapshotRoot)
        execFileSync('tar', ['-xf', archivePath, '-C', snapshotRoot])

        const [baselineBundle, currentBundle] = await Promise.all([bundle(snapshotRoot), bundle(repositoryRoot)])
        const baselineSizes = sizes(baselineBundle)
        const currentSizes = sizes(currentBundle)
        const branch = git(['branch', '--show-current']) || 'detached HEAD'

        console.log(`Fast array.js comparison against ${baselineRef} (${baselineCommit.slice(0, 8)})`)
        console.log(`Current working tree: ${branch}`)
        console.log(`Bundler: esbuild ${esbuildVersion}\n`)
        printTable(baselineSizes, currentSizes)
        console.log(`\nCompleted in ${((performance.now() - startedAt) / 1000).toFixed(2)}s.`)
        console.log('This is an apples-to-apples esbuild comparison; absolute production Rollup sizes will differ.')
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true })
    }
}

main().catch((error) => {
    const detail = error?.stderr?.toString().trim()
    console.error(`array.js size comparison failed: ${detail || error.message}`)
    process.exitCode = 1
})
