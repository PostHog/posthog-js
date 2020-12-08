import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import { terser } from 'rollup-plugin-terser'

const plugins = [
    json(),
    resolve({ browser: true, modulesOnly: true }),
    babel({ babelHelpers: 'bundled', presets: ['@babel/preset-env'] }),
    terser({ ecma: 5 }),
]

const configs = []
configs.push({
    input: 'src/loader-globals.js',
    output: {
        file: 'dist/array.js',
        format: 'esm',
    },
    plugins,
})
configs.push({
    input: 'src/loader-module.js',
    output: {
        file: 'dist/module.js',
        format: 'esm',
    },
    plugins,
})

export default configs
