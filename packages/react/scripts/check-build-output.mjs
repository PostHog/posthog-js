import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

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

assert.deepEqual(await filesUnder(resolve(packageRoot, 'src')), await filesUnder(resolve(browserReactRoot, 'src')))
for (const directory of ['slim', 'surveys']) {
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

console.log('React build output, source maps, externals, globals, and browser copy are valid')
