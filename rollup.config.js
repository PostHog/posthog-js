import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import analyze from 'rollup-plugin-analyzer'
import { terser } from 'rollup-plugin-terser'

const configs = []
configs.push({
    input: 'src/loader-globals.js',
    output: {
        file: 'dist/array.js',
        format: 'esm',
    },
    plugins: [
        json(),
        resolve({ browser: true, modulesOnly: true }),
        babel({ babelHelpers: 'bundled', presets: ['@babel/preset-env'] }),
        terser({ ecma: 5 }),
        analyze(),
    ],
})
configs.push({
    input: 'src/loader-module.js',
    output: {
        file: 'dist/module.js',
        format: 'esm',
    },
    // :TODO: babelHelpers runtime should be better here.
    plugins: [json(), babel({ babelHelpers: 'bundled', presets: ['@babel/preset-env'] }), terser({ ecma: 5 })],
    external: ['fflate'],
})

export default configs
