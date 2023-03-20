import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import dts from 'rollup-plugin-dts'
import pkg from './package.json' assert { type: 'json', integrity: 'sha384-ABC123' }
import terser from '@rollup/plugin-terser'
import commonjs from '@rollup/plugin-commonjs'

const extensions = ['.js', '.jsx', '.ts', '.tsx']
const plugins = [
    json(),
    resolve({ browser: true, modulesOnly: true }),
    typescript({ sourceMap: true }),
    babel({
        extensions,
        babelHelpers: 'bundled',
        presets: [
            [
                '@babel/preset-env',
                {
                    debug: true,
                    // We are targetting ES5, but want to support developing
                    // using modern browser features. So we use the "usage"
                    // option, which will only include polyfills from `corejs`
                    // for features that are actually used.
                    useBuiltIns: 'usage',
                    corejs: '3.29',
                    // Rollup will handle module transformations, so we don't
                    // want bable to do anything.
                    modules: false,
                },
            ],
        ],
    }),
    resolve(),
    commonjs(),
    terser({ toplevel: true }),
]

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
        ],
        plugins: [...plugins],
    },
    {
        input: 'src/loader-recorder-v2.ts',
        output: [
            {
                file: 'dist/recorder-v2.js',
                sourcemap: true,
                format: 'iife',
                name: 'posthog',
            },
        ],
        plugins: [...plugins],
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
        plugins: [...plugins],
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
        plugins: [...plugins],
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
        plugins: [...plugins],
    },
    {
        input: './lib/src/loader-module.d.ts',
        output: [{ file: pkg.types, format: 'es' }],
        plugins: [dts()],
    },
]
