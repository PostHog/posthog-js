import babel from '@rollup/plugin-babel'
import json from '@rollup/plugin-json'
import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

const extensions = ['.js', '.jsx', '.ts', '.tsx']

export default {
    plugins: [
        json(),
        resolve({ browser: true, modulesOnly: true }),
        typescript(),
        babel({ extensions, babelHelpers: 'bundled', presets: ['@babel/preset-env'] }),
    ],
}
