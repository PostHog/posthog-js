import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import dts from 'rollup-plugin-dts'
import pkg from './package.json'
import { terser } from 'rollup-plugin-terser'
import copy from 'rollup-plugin-copy-merge'

const extensions = ['.js', '.jsx', '.ts', '.tsx']
const plugins = [
    json(),
    resolve({ browser: true, modulesOnly: true }),
    typescript({ sourceMap: true }),
    babel({
        extensions,
        babelHelpers: 'bundled',
        presets: ['@babel/preset-env'],
    }),
]

export default [
    {
        input: 'src/loader-globals.ts',
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
            copy({
                targets: [
                    {
                        src: [
                            'node_modules/rrweb/dist/record/rrweb-record.min.js',
                            'node_modules/rrweb/dist/plugins/console-record.min.js',
                        ],
                        file: 'dist/recorder.js',
                    },
                    {
                        src: 'node_modules/rrweb/dist/record/rrweb-record.min.js.map',
                        dest: 'dist/',
                        rename: 'recorder.js.map',
                    },
                    {
                        src: 'node_modules/rrweb/dist/plugins/console-record.min.js.map',
                        dest: 'dist/',
                        rename: 'console-record.min.js.map',
                    },
                    {
                        src: 'dist/recorder.js',
                        dest: 'dist/',
                        transform: (contents) => contents.toString().replace('rrweb-record.min.js.map', 'recorder.js.map')
                    },
                ],
            }),
            terser({ toplevel: true }),
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
        plugins: [...plugins, terser({ toplevel: true })],
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
        plugins,
    },
    {
        input: './lib/src/loader-module.d.ts',
        output: [{ file: pkg.types, format: 'es' }],
        plugins: [dts()],
    },
]
