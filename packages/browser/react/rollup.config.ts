import * as path from 'path'
import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from 'rollup-plugin-typescript2'
import packageJson from './package.json'

const plugins = [
    // Resolve modules from node_modules
    resolve({
        preferBuiltins: false,
        mainFields: ['module', 'main', 'jsnext:main', 'browser'],
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
    }),
    // Compile typescript to javascript
    typescript({
        useTsconfigDeclarationDir: true,
    }),
    // Convert commonjs modules to esm
    commonjs(),
]

/**
 * Configuration for the ESM build
 */
const buildEsm = {
    external: ['posthog-js', 'react'],
    input: [
        // Split modules so they can be tree-shaken
        'src/index.ts',
    ],
    output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-deps.js',
        dir: path.dirname(packageJson.module),
        format: 'esm',
    },
    plugins,
}

/**
 * Configuration for the UMD build
 */
const buildUmd = {
    external: ['posthog-js', 'react'],
    input: 'src/index.ts',
    output: {
        file: packageJson.main,
        name: 'PosthogReact',
        format: 'umd',
        esModule: false,
        globals: {
            react: 'React',
        },
    },
    plugins,
}

export default [buildEsm, buildUmd]
