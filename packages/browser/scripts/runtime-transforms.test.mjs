import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import { test } from 'node:test'
import { rolldown } from 'rolldown'
import { parseSync } from 'rolldown/utils'
import { modernTransformOptions } from '../oxc.config.mjs'

const require = createRequire(import.meta.url)
const esCheck = require.resolve('es-check')

test('every shipped runtime bundle remains ES6, and the legacy bundle remains ES5', () => {
    execFileSync(process.execPath, [esCheck, 'es6', '--module', 'dist/*.js', 'dist/*.mjs'], { stdio: 'pipe' })
    execFileSync(process.execPath, [esCheck, 'es5', 'dist/array.full.es5.js'], { stdio: 'pipe' })
})

test('CJS and ESM entrypoints load without browser globals and expose the same API', async () => {
    const cjs = require('../dist/main.js')
    const esm = await import('../dist/module.mjs')
    assert.deepEqual(Object.keys(cjs).sort(), Object.keys(esm).sort())
    for (const sdk of [cjs.default, esm.default]) {
        assert.equal(typeof sdk.init, 'function')
        assert.equal(typeof sdk.capture, 'function')
    }
})

test('Oxc bundles helpers locally and preserves modern syntax behavior', async () => {
    const source = `
        export async function run(value) {
            let calls = 0;
            const source = { get value() { calls++; return value; } };
            const copy = { ...source };
            const { value: picked, ...rest } = { ...copy, other: 7 };
            class Base { set field(value) { this.fromSetter = value; } }
            class Derived extends Base { field = 4; }
            return [source?.value ?? 3, picked, rest.other, value ** 2, calls, new Derived().fromSetter];
        }
    `
    const build = await rolldown({
        input: 'fixture.js',
        transform: modernTransformOptions,
        plugins: [
            {
                name: 'fixture',
                resolveId(id) {
                    return id === 'fixture.js' ? id : null
                },
                load(id) {
                    return id === 'fixture.js' ? source : null
                },
            },
        ],
    })
    try {
        const { output } = await build.generate({ format: 'iife', name: 'fixture', sourcemap: true })
        const chunk = output.find((file) => file.type === 'chunk')
        assert.deepEqual(chunk.imports, [])
        assert.ok(chunk.map.sources.some((file) => file.endsWith('fixture.js')))
        assert.ok(!chunk.code.includes('@oxc-project/runtime'))
        const context = vm.createContext({})
        vm.runInContext(chunk.code, context)
        assert.deepEqual(Object.keys(context), ['fixture'], 'Helpers must not leak onto the host global')
        assert.deepEqual(Array.from(await context.fixture.run(0)), [0, 0, 7, 0, 2, 4])
        assert.deepEqual(Array.from(await context.fixture.run(null)), [3, null, 7, 0, 2, 4])
    } finally {
        await build.close()
    }
})

test('modern production entries use Oxc; only ES5 and the Rollup ABI fallback use Babel', async () => {
    const original = {
        BUNDLER: process.env.BUNDLER,
        BUILD_ROLLUP_RUNTIME: process.env.BUILD_ROLLUP_RUNTIME,
        ENTRY: process.env.ENTRY,
        BUILD_TYPES_ONLY: process.env.BUILD_TYPES_ONLY,
    }
    try {
        delete process.env.ENTRY
        delete process.env.BUILD_TYPES_ONLY
        delete process.env.BUILD_ROLLUP_RUNTIME
        process.env.BUNDLER = 'rolldown'
        const { default: configs } = await import('../rollup.config.mjs?test=rolldown')
        assert.ok(configs.length > 1)
        for (const config of configs) {
            const legacy = config.input.includes('.es5.')
            assert.equal(
                config.plugins.some((plugin) => plugin.name === 'babel'),
                legacy,
                config.input
            )
            assert.deepEqual(config.transform, legacy ? undefined : modernTransformOptions)
        }
        delete process.env.BUNDLER
        process.env.BUILD_ROLLUP_RUNTIME = '1'
        const { default: fallbacks } = await import('../rollup.config.mjs?test=rollup')
        assert.equal(fallbacks.length, 3)
        for (const config of fallbacks) {
            assert.ok(
                config.plugins.some((plugin) => plugin.name === 'babel'),
                config.input
            )
        }
    } finally {
        for (const [key, value] of Object.entries(original)) {
            // oxlint-disable-next-line posthog-js/no-direct-undefined-check -- Build tests do not depend on SDK helpers.
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
        }
    }
})

test('shipped IIFEs have no transformer helper globals or runtime imports', () => {
    const entries = fs.readdirSync('src/entrypoints').filter((file) => !/\.(es|cjs)\.ts$/.test(file))
    for (const entry of entries) {
        const file = entry.replace(/(?:\.iife)?\.ts$/, '.js')
        const code = fs.readFileSync(`dist/${file}`, 'utf8')
        assert.ok(!code.includes('@oxc-project/runtime'), file)
        const { program, module, errors } = parseSync(file, code)
        assert.deepEqual(errors, [], file)
        assert.deepEqual(module.staticImports, [], file)
        for (const statement of program.body) {
            if (statement.type === 'VariableDeclaration') {
                assert.deepEqual(
                    statement.declarations.map(({ id }) => id.name),
                    ['posthog'],
                    file
                )
            } else {
                assert.equal(statement.type, 'ExpressionStatement', `${file}: unexpected global declaration`)
            }
        }
    }
})
