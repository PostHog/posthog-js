import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { dts } from 'rollup-plugin-dts'
import pkg from './package.json'
import terser from '@rollup/plugin-terser'
import { visualizer } from 'rollup-plugin-visualizer'

const plugins = [
    json(),
    resolve({ browser: true }),
    typescript({ sourceMap: true }),
    babel({
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        babelHelpers: 'bundled',
        presets: ['@babel/preset-env'],
    }),
    terser({ toplevel: true })
]

/** @type {import('rollup').RollupOptions[]} */
export default [
    {
        input: 'src/loader-recorder.ts',
        output: [
            {
                file: 'dist/recorder.js',
                sourcemap: true,
                format: 'iife',
                name: 'posthog',
            },
            {
                // Backwards compatibility for older SDK versions
                file: 'dist/recorder-v2.js',
                sourcemap: true,
                format: 'iife',
                name: 'posthog',
            },
        ],
        plugins: [
            ...plugins,
            visualizer({
                filename: 'stats/recorder.html',
            }),
        ],
    },
    {
        input: 'src/loader-surveys.ts',
        output: [
            {
                file: 'dist/surveys.js',
                sourcemap: true,
                format: 'iife',
                name: 'posthog',
                globals: {
                    preact: 'preact',
                },
            },
        ],
        plugins: [
            ...plugins,
            visualizer({
                filename: 'stats/surveys.html',
            }),
        ],
    },
    {
        input: 'src/loader-surveys-preview.ts',
        output: [
            {
                file: 'dist/surveys-module-previews.js',
                format: 'es',
                sourcemap: true,
            },
        ],
        plugins: [
            ...plugins,
            visualizer({
                filename: 'stats/surveys-preview.html',
            }),
        ],
    },
    {
        input: 'src/loader-exception-autocapture.ts',
        output: [
            {
                file: 'dist/exception-autocapture.js',
                sourcemap: true,
                format: 'iife',
                name: 'posthog',
            },
        ],
        plugins: [
            ...plugins,
            visualizer({
                filename: 'stats/exception-autocapture.html',
            }),
        ],
    },
    {
        input: 'src/loader-globals.ts',
        output: [
            {
                file: 'dist/array.js',
                sourcemap: true,
                format: 'iife',
                name: 'posthog',
            },
        ],
        plugins: [
            ...plugins,
            visualizer({
                filename: 'stats/array.html',
            }),
        ],
    },
    {
        input: 'src/loader-globals-full.ts',
        output: [
            {
                file: 'dist/array.full.js',
                sourcemap: true,
                format: 'iife',
                name: 'posthog',
            },
        ],
        plugins: [
            ...plugins,
            visualizer({
                filename: 'stats/array.full.html',
            }),
        ],
    },
    {
        input: 'src/loader-module.ts',
        output: [
            {
                file: pkg.main,
                format: 'cjs',
                sourcemap: true,
                exports: 'auto',
            },
            {
                file: pkg.module,
                format: 'es',
                sourcemap: true,
            },
        ],
        plugins: [
            ...plugins,
            visualizer({
                filename: 'stats/module.html',
            }),
        ],
    },
    {
        input: './lib/src/loader-module.d.ts',
        output: [{ file: pkg.types, format: 'es' }],
        plugins: [
            dts({
                respectExternal: true,
            }),
        ],
    },
]
