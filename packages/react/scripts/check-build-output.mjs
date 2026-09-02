import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { relative, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { gzipSync } from 'node:zlib'

const packageRoot = resolve(import.meta.dirname, '..')
const browserReactRoot = resolve(packageRoot, '../browser/react')

async function filesUnder(root) {
    const files = []

    async function visit(directory) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = resolve(directory, entry.name)
            if (entry.isDirectory()) {
                await visit(path)
            } else {
                files.push(relative(root, path).replaceAll('\\', '/'))
            }
        }
    }

    await visit(root)
    return files.sort()
}

const expectedDistFiles = [
    'esm/index.js',
    'esm/index.js.map',
    'esm/slim/index.js',
    'esm/slim/index.js.map',
    'esm/surveys/index.js',
    'esm/surveys/index.js.map',
    'types/index.d.ts',
    'types/slim/index.d.ts',
    'types/surveys/index.d.ts',
    'umd/index.js',
    'umd/index.js.map',
    'umd/slim/index.js',
    'umd/slim/index.js.map',
    'umd/surveys/index.js',
    'umd/surveys/index.js.map',
]

assert.deepEqual(await filesUnder(resolve(packageRoot, 'dist')), expectedDistFiles)
assert.deepEqual(await filesUnder(resolve(browserReactRoot, 'dist')), expectedDistFiles)

for (const file of expectedDistFiles) {
    assert.deepEqual(
        await readFile(resolve(packageRoot, 'dist', file)),
        await readFile(resolve(browserReactRoot, 'dist', file)),
        `browser React copy differs for ${file}`
    )
}

const sourceFiles = await filesUnder(resolve(packageRoot, 'src'))
assert.deepEqual(sourceFiles, await filesUnder(resolve(browserReactRoot, 'src')))
for (const file of sourceFiles) {
    assert.deepEqual(
        await readFile(resolve(packageRoot, 'src', file)),
        await readFile(resolve(browserReactRoot, 'src', file)),
        `browser React source copy differs for ${file}`
    )
}

for (const directory of ['slim', 'surveys']) {
    assert.deepEqual(await filesUnder(resolve(packageRoot, directory)), ['package.json'])
    assert.deepEqual(await filesUnder(resolve(browserReactRoot, directory)), ['package.json'])
    assert.deepEqual(
        await readFile(resolve(packageRoot, directory, 'package.json')),
        await readFile(resolve(browserReactRoot, directory, 'package.json'))
    )
}

for (const file of expectedDistFiles.filter((file) => file.endsWith('.js.map'))) {
    const map = JSON.parse(await readFile(resolve(packageRoot, 'dist', file), 'utf8'))
    assert.equal(map.version, 3, `${file} is not a version 3 source map`)
    assert.equal(map.file, 'index.js', `${file} points at the wrong output file`)
    assert.ok(map.mappings.length > 0, `${file} has no mappings`)
    assert.ok(map.sources.length > 0, `${file} has no sources`)
    assert.equal(map.sourcesContent.length, map.sources.length, `${file} is missing source content`)
    assert.ok(
        map.sources.every((source) => source.includes('/src/')),
        `${file} contains a non-source input`
    )
}

const bundles = {
    main: {
        esm: await readFile(resolve(packageRoot, 'dist/esm/index.js'), 'utf8'),
        umd: await readFile(resolve(packageRoot, 'dist/umd/index.js'), 'utf8'),
    },
    slim: {
        esm: await readFile(resolve(packageRoot, 'dist/esm/slim/index.js'), 'utf8'),
        umd: await readFile(resolve(packageRoot, 'dist/umd/slim/index.js'), 'utf8'),
    },
    surveys: {
        esm: await readFile(resolve(packageRoot, 'dist/esm/surveys/index.js'), 'utf8'),
        umd: await readFile(resolve(packageRoot, 'dist/umd/surveys/index.js'), 'utf8'),
    },
}

for (const entry of ['main', 'surveys']) {
    assert.match(bundles[entry].esm, /from ["']posthog-js["']/)
    assert.match(bundles[entry].esm, /from ["']react["']/)
    assert.match(bundles[entry].umd, /require\(["']posthog-js["']\)/)
    assert.match(bundles[entry].umd, /require\(["']react["']\)/)
    assert.match(bundles[entry].umd, /global\.posthog/)
    assert.match(bundles[entry].umd, /global\.React/)
}

assert.doesNotMatch(bundles.slim.esm, /["']posthog-js["']/)
assert.doesNotMatch(bundles.slim.umd, /["']posthog-js["']/)
assert.match(bundles.slim.esm, /from ["']react["']/)
assert.match(bundles.slim.umd, /require\(["']react["']\)/)
assert.match(bundles.main.umd, /global\.PosthogReact = \{\}/)
assert.match(bundles.slim.umd, /global\.PosthogReactSlim = \{\}/)
assert.match(bundles.surveys.umd, /global\.PosthogReactSurveys = \{\}/)

const require = createRequire(import.meta.url)
for (const [entry, bundle] of Object.entries(bundles)) {
    assert.doesNotMatch(bundle.umd, /Symbol\.toStringTag/, `${entry} UMD requires Symbol`)
    assert.match(bundle.umd, /function \([^)]*\) \{\n\s+["']use strict["'];/, `${entry} UMD is not strict`)

    const commonJsModule = { exports: {} }
    const sandbox = {
        console,
        exports: commonJsModule.exports,
        module: commonJsModule,
        require,
        Symbol: undefined,
    }
    runInNewContext(bundle.umd, sandbox)
    assert.equal('__extends' in sandbox, false, `${entry} UMD leaks a TypeScript helper globally`)
}

// Keep compressed payloads within 15% of the Rollup baseline captured for this migration.
const baselineGzipBytes = {
    'esm/index.js': 5234,
    'esm/slim/index.js': 4399,
    'esm/surveys/index.js': 1840,
    'umd/index.js': 5572,
    'umd/slim/index.js': 4708,
    'umd/surveys/index.js': 1990,
}
for (const [file, baselineBytes] of Object.entries(baselineGzipBytes)) {
    const bytes = gzipSync(await readFile(resolve(packageRoot, 'dist', file))).byteLength
    assert.ok(bytes <= Math.ceil(baselineBytes * 1.15), `${file} gzip size grew more than 15%: ${bytes} bytes`)
}

console.log('React build output, ES5 UMD behavior, size, source maps, externals, globals, and browser copy are valid')
