import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'  
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import dts from 'rollup-plugin-ts'
import terser from '@rollup/plugin-terser'
import { visualizer } from 'rollup-plugin-visualizer'
import fs from 'fs'

const plugins = [
    json(),
    resolve({ browser: true }),
    typescript({ sourceMap: true }),
    babel({
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        babelHelpers: 'bundled',
        presets: ['@babel/preset-env'],
    }),
    terser({ toplevel: true }),
]

/** @type {import('rollup').RollupOptions[]} */

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
        const dest = `./dist/${file.replace('.es.ts', '.d.ts')}`

        return {
            input: source,
            output: [{ file: dest, format: 'es' }],
            plugins: [
                dts({
                    exclude: [],
                }),
            ],
        }
    })

export default [...entrypointTargets, ...typeTargets]
