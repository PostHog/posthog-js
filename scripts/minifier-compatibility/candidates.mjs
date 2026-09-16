// Diagnostic adapters only. Never imported by the browser build.
import { minify as terser } from 'terser'
import { minify as oxc } from 'oxc-minify'
import { minify as rolldownOxc } from 'rolldown/utils'
import { minify as swc, experimental_newMangleNameCache } from '@swc/core'

export const compression = {
    ecma: 6,
    passes: 2,
    pure_getters: true,
    unsafe_methods: true,
    unsafe_comps: true,
    unsafe_math: true,
    unsafe_proto: true,
    unsafe_regexp: true,
}

export function candidate(engine, { reserved = [], cache = {}, compress = true, target = 2015 } = {}) {
    let propertyCache = structuredClone(cache)
    const swcCache = engine === 'swc' ? experimental_newMangleNameCache() : undefined
    return async (source, filename = 'fixture.js') => {
        if (engine === 'terser') {
            const nameCache = {
                vars: { props: {} },
                props: {
                    props: Object.fromEntries(Object.entries(propertyCache).map(([key, value]) => [`$${key}`, value])),
                },
            }
            const result = await terser(
                { [filename]: source },
                {
                    nameCache,
                    module: false,
                    toplevel: true,
                    compress: compress ? { ...compression, ecma: target === 5 ? 5 : 6 } : false,
                    format: { comments: false },
                    mangle: { reserved: ['$'], properties: { regex: /^_(?!_)/, reserved } },
                    sourceMap: { asObject: true },
                }
            )
            propertyCache = Object.fromEntries(
                Object.entries(nameCache.props.props).map(([key, value]) => [key.slice(1), value])
            )
            return { ...result, cache: structuredClone(propertyCache) }
        }
        if (engine === 'oxc' || engine === 'rolldown-oxc') {
            const minify = engine === 'oxc' ? oxc : rolldownOxc
            const result = await minify(filename, source, {
                module: false,
                mangle: { toplevel: true, reserved: ['$'] },
                compress: compress
                    ? { target: target === 5 ? 'es5' : 'es2015', treeshake: { propertyReadSideEffects: false } }
                    : false,
                // Equivalent selection without unsupported Rust regex lookahead. Terser
                // rewrites quoted occurrences by default, unlike Oxc.
                mangleProps: { include: /^_/, exclude: /^__/, quoted: true, reserved, cache: propertyCache },
                sourcemap: true,
            })
            if (result.errors.length) throw new Error(JSON.stringify(result.errors))
            propertyCache = result.mangleCache ?? {}
            return { ...result, cache: structuredClone(propertyCache) }
        }
        if (engine === 'swc') {
            const result = await swc(
                { [filename]: source },
                {
                    module: false,
                    toplevel: true,
                    ecma: target,
                    compress: compress ? { ...compression, ecma: target } : false,
                    format: { comments: false },
                    mangle: { reserved: ['$'], properties: { regex: '^_($|[^_])', reserved } },
                    sourceMap: true,
                },
                { mangleNameCache: swcCache }
            )
            return { ...result, map: JSON.parse(result.map) }
        }
        throw new Error(`Unknown engine: ${engine}`)
    }
}
