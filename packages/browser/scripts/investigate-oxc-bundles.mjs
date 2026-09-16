/* oxlint-disable no-console, compat/compat -- Node-only diagnostic CLI. */
// Run after a production build. This is an opt-in migration probe,
// not a replacement for the production property, source-map, or browser checks.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'
import { modernTransformOptions } from '../oxc.config.mjs'
import { extractPropertyNames, validatePropertyClassification } from './check-mangled-property-consistency.js'
import propertyConfig from '../terser-cross-bundle-properties.cjs'

const browserDirectory = fileURLToPath(new URL('..', import.meta.url))
process.chdir(browserDirectory)
const entries = ['extension-bundles', 'module.slim', 'module.slim.no-external']
const [mode, destination] = process.argv.slice(2)

if (mode === '--minimal') {
    const source = 'export const keep = 1; const unused = async () => { await sideEffect() };'
    console.log(source)
    for (const [label, transform] of [
        ['before lowering', {}],
        ['Oxc ES2015', modernTransformOptions],
    ]) {
        const build = await rolldown({
            input: 'fixture.js',
            transform,
            plugins: [
                {
                    name: 'fixture',
                    resolveId: (id) => (id === 'fixture.js' ? id : null),
                    load: (id) => (id === 'fixture.js' ? source : null),
                },
            ],
        })
        try {
            const {
                output: [chunk],
            } = await build.generate({ format: 'es' })
            console.log(`${label}: unused body retained = ${chunk.code.includes('sideEffect')}`)
            console.log(chunk.code)
        } finally {
            await build.close()
        }
    }
} else if (!mode) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'posthog-oxc-probe-'))
    // Separate processes reset the shared Terser cache between experiments; within each
    // experiment all three entries share the exact production cache and minifier.
    for (const variant of ['babel', 'oxc']) {
        const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), variant, directory], {
            stdio: 'inherit',
        })
        assert.equal(result.status, 0, `${variant} probe failed`)
    }
    console.log(`Artifacts and measurements: ${directory}`)
} else {
    assert.ok(['babel', 'oxc'].includes(mode) && destination, 'Expected babel|oxc and an output directory')
    // Ignore caller entry filters: all entries must share one Terser name cache.
    delete process.env.ENTRY
    delete process.env.BUILD_TYPES_ONLY
    delete process.env.WRITE_MANGLED_PROPERTIES
    const { default: configurations } = await import('../rollup.config.mjs')
    const directory = path.join(destination, mode)
    fs.mkdirSync(directory, { recursive: true })
    const measurements = []
    for (const config of configurations) {
        const name = path.basename(config.output[0].file, '.js')
        if (!entries.includes(name)) continue
        if (mode === 'oxc') {
            config.transform = modernTransformOptions
            config.plugins = config.plugins.filter((plugin) => plugin.name !== 'babel')
        }
        // Visualization is irrelevant to this transform comparison and writes outside output.dir.
        config.plugins = config.plugins.filter((plugin) => plugin.name !== 'visualizer')
        const { output, ...input } = config
        const start = performance.now()
        const build = await rolldown(input)
        try {
            await build.write({ ...output[0], file: path.join(directory, `${name}.js`) })
        } finally {
            await build.close()
        }
        const seconds = (performance.now() - start) / 1000
        const code = fs.readFileSync(path.join(directory, `${name}.js`))
        const map = JSON.parse(fs.readFileSync(path.join(directory, `${name}.js.map`), 'utf8'))
        measurements.push({
            entry: name,
            seconds: Number(seconds.toFixed(3)),
            bytes: code.length,
            gzip: gzipSync(code).length,
            brotli: brotliCompressSync(code).length,
            compressionSources: map.sources.filter((source) => /fflate|\/gzip\.mjs$|\/encode-utils\.mjs$/.test(source)),
            hasTransportName: map.names.includes('AVAILABLE_TRANSPORTS'),
            ignoreListsComplete: ['ignoreList', 'x_google_ignoreList'].every(
                (key) => map[key]?.length === map.sources.length && map[key].every((value, index) => value === index)
            ),
        })
    }
    const properties = (name, definitions = false) => {
        const file = path.join(directory, `${name}.js`)
        return extractPropertyNames(file, `${file}.map`, definitions)
    }
    const extension = properties('extension-bundles', true)
    const noExternal = properties('module.slim.no-external', true)
    const extensionAccesses = properties('extension-bundles')
    const slimAccesses = properties('module.slim')
    const overlaps = Object.keys(extension).filter((name) => noExternal[name])
    const classificationErrors = validatePropertyClassification(
        overlaps,
        propertyConfig.crossBundlePrivateProperties,
        propertyConfig.knownNonAbiOverlaps
    )
    const mismatches = (left, right, names) =>
        names.filter(
            (name) => left[name]?.length !== 1 || right[name]?.length !== 1 || left[name][0] !== right[name][0]
        )
    const report = {
        mode,
        measurements,
        classificationErrors,
        abiMismatches: mismatches(noExternal, extension, propertyConfig.crossBundlePrivateProperties),
        sharedAccessMismatches: mismatches(
            slimAccesses,
            extensionAccesses,
            Object.keys(extensionAccesses).filter((name) => slimAccesses[name])
        ),
    }
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
    if (mode === 'babel') {
        assert.deepEqual(classificationErrors, [])
        assert.deepEqual(report.abiMismatches, [])
        assert.deepEqual(report.sharedAccessMismatches, [])
        assert.deepEqual(measurements.find(({ entry }) => entry === 'extension-bundles').compressionSources, [])
    }
}
