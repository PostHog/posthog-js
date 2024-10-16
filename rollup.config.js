import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { dts } from 'rollup-plugin-dts'
import terser from '@rollup/plugin-terser'
import { visualizer } from 'rollup-plugin-visualizer'
import fs from 'fs'
import path from 'path'

const plugins = [
    json(),
    resolve({ browser: true }),
    typescript({ sourceMap: true }),
    babel({
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        babelHelpers: 'bundled',
        presets: [
            [
                '@babel/preset-env',
                {
                    debug: true,
                    corejs: '3.38',
                    useBuiltIns: 'usage',
                    include: ['es.array.from'],
                    exclude: [
                        'es.error.cause',
                        'es.array.concat',
                        'es.array.find',
                        'es.array.find-index',
                        'es.array.fill',
                        'es.array.filter',
                        'es.array.flat-map',
                        'es.array.includes',
                        'es.array.iterator',
                        'es.array.join',
                        'es.array.map',
                        'es.array.slice',
                        'es.array.splice',
                        'es.array.sort',
                        'es.array.unscopables.flat-map',
                        'es.array-buffer.constructor',
                        'es.function.name',
                        'es.global-this',
                        'es.json.stringify',
                        'es.map',
                        'es.number.constructor',
                        'es.number.is-integer',
                        'es.number.to-fixed',
                        'es.object.assign',
                        'es.object.entries',
                        'es.object.get-own-property-descriptor',
                        'es.object.get-own-property-names',
                        'es.object.keys',
                        'es.object.to-string',
                        'es.object.values',
                        'es.promise',
                        'es.promise.finally',
                        'es.reflect.get',
                        'es.reflect.to-string-tag',
                        'es.regexp.*',
                        'es.set',
                        'es.string.ends-with',
                        'es.string.includes',
                        'es.string.iterator',
                        'es.string.link',
                        'es.string.match',
                        'es.string.match-all',
                        'es.string.replace',
                        'es.string.starts-with',
                        'es.string.split',
                        'es.string.sub',
                        'es.string.trim',
                        'es.symbol',
                        'es.symbol.description',
                        'es.typed-array.*',
                        'es.weak-map',
                        'es.weak-set',
                        'esnext.typed-array.*',
                        'web.atob',
                        'web.dom-collections.for-each',
                        'web.dom-collections.iterator',
                        'web.dom-exception.constructor',
                        'web.dom-exception.stack',
                        'web.url',
                        'web.url-search-params',
                        'web.url.to-json',
                    ],
                    targets: '>0.5%, last 2 versions, Firefox ESR, not dead, IE 11',
                },
            ],
        ],
    }),
    terser({ toplevel: true }),
]

const entrypoints = fs.readdirSync('./src/entrypoints')

const entrypointTargets = entrypoints.map((file) => {
    const fileParts = file.split('.')
    // pop the extension
    fileParts.pop()

    let format = fileParts[fileParts.length - 1]
    // NOTE: Sadly we can't just use the file extensions as tsc won't compile things correctly
    if (['cjs', 'es', 'iife'].includes(format)) {
        fileParts.pop()
    } else {
        format = 'iife'
    }

    const fileName = fileParts.join('.')

    // we're allowed to console log in this file :)
    // eslint-disable-next-line no-console
    console.log(`Building ${fileName} in ${format} format`)

    /** @type {import('rollup').RollupOptions} */
    return {
        input: `src/entrypoints/${file}`,
        output: [
            {
                file: `dist/${fileName}.js`,
                sourcemap: true,
                format,
                ...(format === 'iife'
                    ? {
                          name: 'posthog',
                          globals: {
                              preact: 'preact',
                          },
                      }
                    : {}),
                ...(format === 'cjs' ? { exports: 'auto' } : {}),
            },
        ],
        plugins: [...plugins, visualizer({ filename: `bundle-stats-${fileName}.html` })],
    }
})

const typeTargets = entrypoints
    .filter((file) => file.endsWith('.es.ts'))
    .map((file) => {
        const source = `./lib/src/entrypoints/${file.replace('.ts', '.d.ts')}`
        /** @type {import('rollup').RollupOptions} */
        return {
            input: source,
            output: [
                {
                    dir: path.resolve('./dist'),
                    entryFileNames: file.replace('.es.ts', '.d.ts'),
                },
            ],
            plugins: [
                json(),
                dts({
                    exclude: [],
                }),
            ],
        }
    })

export default [...entrypointTargets, ...typeTargets]
