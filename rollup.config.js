import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { dts } from 'rollup-plugin-dts'
import pkg from './package.json'
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
    visualizer(),
]

/** @type {import('rollup').RollupOptions[]} */

const entrypoints = fs.readdirSync('./src/entrypoints').map((file) => {
    const fileParts = file.split('.')
    const extension = fileParts.pop()
    const fileName = fileParts.join('.')

    return {
        input: `src/entrypoints/${file}`,
        output: [
            {
                file: `dist/${fileName}.js`,
                sourcemap: true,
                format: extension === 'mts' ? 'es' : extension === 'cts' ? 'cjs' : 'iife',
                ...(extension === 'ts'
                    ? {
                          name: 'posthog',
                          globals: {
                              preact: 'preact',
                          },
                      }
                    : {}),
                ...(extension === 'cts' ? { exports: 'auto' } : {}),
            },
        ],
        plugins: [...plugins],
    }
})

export default [
    ...entrypoints,
    {
        input: './lib/src/entrypoints/module.d.mts',
        output: [{ file: pkg.types, format: 'es' }],
        plugins: [
            dts({
                respectExternal: true,
            }),
        ],
    },
]
