import { resolve, commonjs, typescript } from '@posthog-tooling/rollup-utils'
import copy from 'rollup-plugin-copy'

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
        dir: 'dist/esm',
        format: 'esm',
    },
    plugins: [...plugins],
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
        // Copy the build to the browser directory for retrocompatibility
        copy({
            targets: [{ src: 'dist/*', dest: '../browser/react/dist' }],
            hook: 'buildEnd',
        }),
    ],
}

export default [buildEsm, buildUmd]
