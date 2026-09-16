import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { parse } from 'acorn'
import { decode } from '@jridgewell/sourcemap-codec'
import { minify as oxc } from 'oxc-minify'
import { minify as swc } from '@swc/core'
import { candidate } from './candidates.mjs'
import boundary from '../../packages/browser/terser-cross-bundle-properties.cjs'

// oxlint-disable-next-line compat/compat -- This Node-only probe resolves a repository file, not a browser URL.
const inventory = JSON.parse(readFileSync(new URL('../../packages/browser/terser-mangled-names.json', import.meta.url)))
const reserved = [...boundary.crossBundlePrivateProperties, '_i', '_', '_noHeatmaps']
const engines = ['terser', 'oxc', 'swc']
const evaluate = (code, context = {}) => {
    runInNewContext(code, context, { timeout: 1000 })
    return context
}

test('inventory records original spellings, not persisted output mappings', () => {
    assert.deepEqual(Object.keys(inventory).sort(), ['//', 'names'])
    assert.ok(inventory.names.length > 0)
    assert.equal(new Set(inventory.names).size, inventory.names.length)
    assert.deepEqual(inventory.names, [...inventory.names].sort())
})

test('BLOCKER: installed Rolldown Oxc does not apply property mangling options', async () => {
    const source = 'globalThis.result = {_privateProbe: 7};'
    const baseline = await candidate('terser')(source)
    const result = await candidate('rolldown-oxc')(source)
    assert.equal(Object.keys(evaluate(baseline.code).result).includes('_privateProbe'), false)
    assert.deepEqual(Object.keys(evaluate(result.code).result), ['_privateProbe'])
    assert.deepEqual(result.cache, {})
})

test('both standalone candidates need a regex adapter; Oxc also needs quoted:true', async () => {
    const source = 'var o={_privateProbe:7};globalThis.result=o["_privateProbe"];'
    const badRegex = await oxc('fixture.js', source, { mangleProps: { include: /^_(?!_)/ } })
    assert.match(badRegex.errors[0].message, /look-around/)
    await assert.rejects(swc(source, { mangle: { properties: { regex: '^_(?!_)' } } }))
    const defaultQuoted = await oxc('fixture.js', source, { mangleProps: { include: /^_/ } })
    assert.equal(evaluate(defaultQuoted.code).result, undefined)
    for (const engine of engines) assert.equal(evaluate((await candidate(engine)(source)).code).result, 7)
})

test('Oxc imports and round-trips a Terser mapping for the entire checked-in inventory', async () => {
    const source = `globalThis.result={${inventory.names.map((name, index) => `${name}:${index}`).join(',')}};`
    const baseline = await candidate('terser')(source)
    assert.equal(Object.keys(baseline.cache).length, inventory.names.length)
    const persisted = JSON.parse(JSON.stringify(baseline.cache))
    const adapted = await candidate('oxc', { cache: persisted })(source)
    assert.deepEqual(adapted.cache, baseline.cache)
    assert.deepEqual(
        JSON.parse(JSON.stringify(evaluate(adapted.code).result)),
        JSON.parse(JSON.stringify(evaluate(baseline.code).result))
    )
})

test('BLOCKER: SWC cache is opaque and cannot import a Terser mapping', async () => {
    const source = 'globalThis.result={_privateProbe:7};'
    const baseline = await candidate('terser')(source)
    const nameCache = {
        props: {
            props: Object.fromEntries(Object.entries(baseline.cache).map(([name, value]) => [`$${name}`, value])),
        },
    }
    await assert.rejects(
        swc(source, { mangle: { properties: { regex: '^_' } } }, { mangleNameCache: nameCache }),
        /external value/
    )
})

// These are reduced contract fixtures, NOT downloaded historical SDKs. The old
// side is frozen Terser output for this run. Startup reads saved configuration
// before an explicitly delivered remote-config update, including absent fields.
const coreSource = `
    globalThis.core = {
        _onIdentityChanged: function(callback) { callback('identity'); },
        _onOptOut: function(callback) { callback(false); },
        capture: function(event) { trace.push(event); },
        get_property: function() { return saved; }
    };
`
const lazySource = `
    core._onIdentityChanged(function(value) { core.capture(value); });
    core._onOptOut(function(value) { if (value) core.capture('opt-out'); });
    var config = core.get_property('recording');
    if (config && config.enabled) core.capture('persisted-start');
    globalThis.remoteConfigArrived = function(config) {
        if (config.enabled) core.capture('remote-start');
    };
`

test('reserved core/lazy contracts survive all engine pairs before delayed config, including inverse skew', async () => {
    for (const coreEngine of engines) {
        for (const lazyEngine of engines) {
            const core = await candidate(coreEngine, { reserved })(coreSource, 'core.js')
            const lazy = await candidate(lazyEngine, { reserved })(lazySource, 'lazy.js')
            for (const saved of [{ enabled: true }, undefined]) {
                const context = { saved, trace: [] }
                evaluate(core.code, context)
                evaluate(lazy.code, context)
                assert.deepEqual(
                    context.trace,
                    saved ? ['identity', 'persisted-start'] : ['identity'],
                    `${coreEngine}/${lazyEngine}`
                )
                context.remoteConfigArrived({ enabled: true })
                assert.equal(context.trace.at(-1), 'remote-start')
            }
        }
    }
})

test('synthetic mangled boundary: shared caches work; Oxc needs imported names for Terser skew', async () => {
    const core = 'globalThis.core={_sharedProbe:function(){return 7},_unrelated:2};'
    const lazy = '(function(core){globalThis.result=core._sharedProbe();})(globalThis.core);'
    for (const engine of ['terser', 'oxc']) {
        const minify = candidate(engine)
        const first = await minify(core, 'core.js')
        const second = await minify(lazy, 'lazy.js')
        const context = evaluate(first.code)
        evaluate(second.code, context)
        assert.equal(context.result, 7, engine)
        assert.equal(await candidate(engine)(core).then((r) => r.code), first.code, `${engine} repeat`)
    }
    const baseline = candidate('terser')
    const oldCore = await baseline(core)
    const oldLazy = await baseline(lazy)
    const adapter = candidate('oxc', { cache: JSON.parse(JSON.stringify(oldCore.cache)) })
    const newCore = await adapter(core)
    const newLazy = await adapter(lazy)
    for (const [left, right] of [
        [oldCore, newLazy],
        [newCore, oldLazy],
    ]) {
        const context = evaluate(left.code)
        evaluate(right.code, context)
        assert.equal(context.result, 7)
    }
    // This synthetic private ABI is deliberately not in the reservation list.
    // Matching algorithm labels do not imply matching emitted property names.
    const unseeded = await candidate('oxc')(lazy)
    assert.throws(() => evaluate(unseeded.code, evaluate(oldCore.code)), /not a function/)
})

test('BLOCKER: SWC native cache does not coordinate property names across calls', async () => {
    const minify = candidate('swc')
    const core = await minify('globalThis.core={_sharedProbe:function(){return 7},_unrelated:2};')
    const lazy = await minify('(function(core){globalThis.result=core._sharedProbe();})(globalThis.core);')
    assert.throws(() => evaluate(lazy.code, evaluate(core.code)), /not a function/)
})

test('serial cache extension preserves old names and exported Oxc caches survive restart', async () => {
    for (const engine of ['terser', 'oxc']) {
        const minify = candidate(engine)
        const first = await minify('globalThis.first={_sharedProbe:1};')
        const second = await minify('globalThis.second={_newProbe:2,_sharedProbe:1};')
        assert.equal(second.cache._sharedProbe, first.cache._sharedProbe)
        assert.notEqual(second.cache._newProbe, first.cache._sharedProbe)
        const restarted = await candidate(engine, { cache: JSON.parse(JSON.stringify(second.cache)) })(
            'globalThis.second={_newProbe:2,_sharedProbe:1};'
        )
        assert.deepEqual(restarted.cache, second.cache)
        assert.equal(restarted.code, second.code)
    }
})

test('fresh build order can change assignments; a name inventory alone cannot stabilize them', async () => {
    for (const engine of ['terser', 'oxc']) {
        const firstOrder = candidate(engine)
        const secondOrder = candidate(engine)
        const a = 'globalThis.a={_firstProbe:1};'
        const b = `globalThis.b={${Array.from({ length: 64 }, (_, i) => `_warmup${i}:${i}`).join(',')}};`
        await firstOrder(a)
        const first = await firstOrder(b)
        await secondOrder(b)
        const second = await secondOrder(a)
        assert.notEqual(first.cache._firstProbe, second.cache._firstProbe, engine)
    }
})

test('all classified ABI reservations and double-underscore properties remain unchanged', async () => {
    const kept = [...reserved, '__publicProbe']
    const source = `globalThis.result={${[...kept, '_privateProbe'].map((name) => `${name}:7`).join(',')}};`
    for (const engine of engines) {
        const result = evaluate((await candidate(engine, { reserved })(source)).code).result
        for (const name of kept) assert.equal(result[name], 7, `${engine}/${name}`)
        assert.equal(Object.hasOwn(result, '_privateProbe'), false, engine)
    }
    // The no-external core deliberately keeps all properties. Its classified
    // boundary must still work with each separately minified extension.
    for (const engine of engines) {
        const context = evaluate(coreSource, { saved: { enabled: true }, trace: [] })
        evaluate((await candidate(engine, { reserved })(lazySource)).code, context)
        assert.deepEqual(context.trace, ['identity', 'persisted-start'])
    }
})

test('BLOCKER: Oxc compression materializes a computed property after mangling', async () => {
    const source = 'var o={_privateProbe:7};globalThis.result=o["_private"+"Probe"];'
    assert.equal(evaluate(source).result, 7)
    assert.equal(evaluate((await candidate('terser')(source)).code).result, 7)
    assert.equal(evaluate((await candidate('swc')(source)).code).result, 7)
    const result = await candidate('oxc')(source)
    assert.ok(result.cache._privateProbe)
    assert.equal(evaluate(result.code).result, undefined)
})

test('BLOCKER: SWC does not rewrite a mangled property name in an in-expression', async () => {
    const source = 'var o={_privateProbe:7};globalThis.result="_privateProbe" in o;'
    assert.equal(evaluate(source).result, true)
    for (const engine of ['terser', 'oxc']) assert.equal(evaluate((await candidate(engine)(source)).code).result, true)
    assert.equal(evaluate((await candidate('swc')(source)).code).result, false)
})

test('targeted compression/runtime and syntax smoke checks', async () => {
    const source = `
        var calls = 0;
        function count(value) { calls++; return value; }
        var o = {_privateProbe: count(3), __public: 4, _i: 5};
        try { throw count('error'); } catch (error) { globalThis.error = error; }
        globalThis.result = [o._privateProbe, o.__public, o._i, calls, 1 / -0, typeof missing];
        if (false) globalThis.deadCodeMarker = 'unreachable';
    `
    const original = evaluate(source)
    for (const engine of engines) {
        const result = await candidate(engine, { reserved })(source)
        const context = evaluate(result.code)
        assert.deepEqual([...context.result], [...original.result], engine)
        assert.equal(context.error, original.error)
        assert.equal(result.code.includes('deadCodeMarker'), false)
        parse(result.code, { ecmaVersion: 2015 })
        // ES5 input is already lowered by Babel in production. This is not a
        // claim that either minifier can downlevel arbitrary modern syntax.
        if (engine !== 'oxc') {
            const es5 = await candidate(engine, { reserved, target: 5 })(source)
            parse(es5.code, { ecmaVersion: 5 })
            assert.deepEqual([...evaluate(es5.code).result], [...original.result])
        }
    }
})

test('BLOCKER: Oxc cannot accept the ES5 compression target', async () => {
    await assert.rejects(candidate('oxc', { target: 5 })('globalThis.result = 1;'), /Invalid target 'es5'/)
})

test('BLOCKER: Oxc loses a function-valued property definition name needed by ABI map checks', async () => {
    const source = 'globalThis.core={_sharedProbe:function(){return 7},_unrelated:2};'
    for (const engine of ['terser', 'swc']) {
        assert.ok((await candidate(engine)(source)).map.names.includes('_sharedProbe'))
    }
    assert.equal((await candidate('oxc')(source)).map.names.includes('_sharedProbe'), false)
})

test('source-map smoke: valid segments and property names survive minification', async () => {
    const source = 'globalThis.result = globalThis.input._privateProbe;'
    for (const engine of engines) {
        const result = await candidate(engine, { compress: false })(source, 'original.js')
        assert.equal(result.map.version, 3)
        assert.ok(result.map.sources.includes('original.js'), engine)
        assert.ok(result.map.names.includes('_privateProbe'), engine)
        const lines = result.code.split('\n')
        let namedSegments = 0
        for (const [line, segments] of decode(result.map.mappings).entries()) {
            for (const segment of segments) {
                assert.ok(segment[0] <= lines[line].length)
                if (segment.length === 5 && result.map.names[segment[4]] === '_privateProbe') namedSegments++
            }
        }
        assert.ok(namedSegments > 0, engine)
    }
})
