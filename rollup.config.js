import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import dts from 'rollup-plugin-dts'
import pkg from './package.json'
// import { terser } from 'rollup-plugin-terser'

const extensions = ['.js', '.jsx', '.ts', '.tsx']

export default [
    {
        input: 'src/loader-globals.ts',
        output: [
            {
                file: 'array.js',
                sourcemap: true,
                format: 'umd',
                name: 'posthog' ,
                amd: {
                    id: 'my-bundle'
                  }
            }
        ],
        plugins: [
            json(),
            resolve({ browser: true, modulesOnly: true }),
            typescript({ sourceMap: true }),
            babel({ extensions, babelHelpers: 'bundled', presets: ['@babel/preset-env'] })
        ]
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
            json(),
            resolve({ browser: true, modulesOnly: true }),
            typescript({ sourceMap: true }),
            babel({ extensions, babelHelpers: 'bundled', presets: ['@babel/preset-env'] }),
        ],
    },
    {
        input: './lib/src/loader-module.d.ts',
        output: [{ file: pkg.types, format: 'es' }],
        plugins: [dts()],
    }, 
]
