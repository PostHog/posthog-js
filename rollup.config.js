import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'

export default {
    plugins: [
        json(),
        resolve({ browser: true, modulesOnly: true }),
        babel({ babelHelpers: 'bundled', presets: ['@babel/preset-env'] }),
    ],
}
