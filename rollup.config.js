import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { dts } from 'rollup-plugin-dts'
import terser from '@rollup/plugin-terser'
import { visualizer } from 'rollup-plugin-visualizer'
import commonjs from '@rollup/plugin-commonjs'
import fs from 'fs'
import path from 'path'

const plugins = (es5) => [
    json(),
    resolve({ browser: true }),
    typescript({ sourceMap: true, outDir: './dist' }),
    commonjs(),
    babel({
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        babelHelpers: 'bundled',
        plugins: ['@babel/plugin-transform-nullish-coalescing-operator'],
        presets: [
            [
                '@babel/preset-env',
                {
                    targets: es5
                        ? '>0.5%, last 2 versions, Firefox ESR, not dead, IE 11'
                        : '>0.5%, last 2 versions, Firefox ESR, not dead',
                },
            ],
        ],
    }),
    terser({
        toplevel: true,
        compress: {
            // 5 is the default if unspecified
            ecma: es5 ? 5 : 6,
        },
    }),
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

    const pluginsForThisFile = plugins(fileName.includes('es5'))

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
        plugins: [...pluginsForThisFile, visualizer({ filename: `bundle-stats-${fileName}.html` })],
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
