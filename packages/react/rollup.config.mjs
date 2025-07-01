import { resolve, typescript, commonjs } from '@posthog-tooling/rollup-utils'
import copy from 'rollup-plugin-copy'

const extensions = ['.js', '.jsx', '.ts', '.tsx']

const plugins = [
    // Resolve modules from node_modules
    resolve({
        preferBuiltins: false,
        mainFields: ['module', 'main', 'jsnext:main', 'browser'],
        extensions,
    }),
    commonjs(),
    // Compile typescript to javascript
    typescript({
        useTsconfigDeclarationDir: true,
    }),
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
        dir: 'dist/esm',
        format: 'esm',
    },
    plugins,
}

/**
 * Configuration for the UMD build
 */
const buildUmd = {
    external: ['posthog-js', 'react'],
    input: './src/index.ts',
    output: {
        file: 'dist/umd/index.js',
        name: 'PosthogReact',
        format: 'umd',
        esModule: false,
        globals: {
            react: 'React',
            'posthog-js': 'posthog',
        },
    },
    plugins: [
        ...plugins,
        copy({
            hook: 'writeBundle',
            targets: [{ src: 'dist/*', dest: '../browser/react/dist' }],
        }),
    ],
}

export default [buildEsm, buildUmd]
