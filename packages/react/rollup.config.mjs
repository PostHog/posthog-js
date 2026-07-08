import { resolve, typescript, commonjs, dts } from '@posthog-tooling/rollup-utils'
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
        tsconfig: './tsconfig.json',
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
        file: 'dist/esm/index.js',
        format: 'esm',
        sourcemap: true,
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
        sourcemap: true,
        esModule: false,
        globals: {
            react: 'React',
            'posthog-js': 'posthog',
        },
    },
    plugins,
}

const buildTypes = {
    external: ['posthog-js', 'react'],
    input: './src/index.ts',
    output: {
        file: 'dist/types/index.d.ts',
        format: 'es',
    },
    plugins: [resolve(), dts()],
}

/**
 * Configuration for the slim build (no posthog-js runtime dependency)
 */
const buildSlimEsm = {
    external: ['posthog-js', 'react'],
    input: 'src/slim.ts',
    output: {
        file: 'dist/esm/slim/index.js',
        format: 'esm',
        sourcemap: true,
    },
    plugins,
}

const buildSlimUmd = {
    external: ['posthog-js', 'react'],
    input: 'src/slim.ts',
    output: {
        file: 'dist/umd/slim/index.js',
        name: 'PosthogReactSlim',
        format: 'umd',
        sourcemap: true,
        esModule: false,
        globals: {
            react: 'React',
            'posthog-js': 'posthog',
        },
    },
    plugins,
}

const buildSlimTypes = {
    external: ['posthog-js', 'react'],
    input: 'src/slim.ts',
    output: {
        file: 'dist/types/slim/index.d.ts',
        format: 'es',
    },
    plugins: [resolve(), dts()],
}

const buildSurveysEsm = {
    external: ['posthog-js', 'react'],
    input: 'src/surveys/index.ts',
    output: {
        file: 'dist/esm/surveys/index.js',
        format: 'esm',
        sourcemap: true,
    },
    plugins,
}

const buildSurveysUmd = {
    external: ['posthog-js', 'react'],
    input: 'src/surveys/index.ts',
    output: {
        file: 'dist/umd/surveys/index.js',
        name: 'PosthogReactSurveys',
        format: 'umd',
        sourcemap: true,
        esModule: false,
        globals: {
            react: 'React',
            'posthog-js': 'posthog',
        },
    },
    plugins,
}

const buildSurveysTypes = {
    external: ['posthog-js', 'react'],
    input: 'src/surveys/index.ts',
    output: {
        file: 'dist/types/surveys/index.d.ts',
        format: 'es',
    },
    plugins: [
        resolve(),
        dts(),
        copy({
            hook: 'writeBundle',
            targets: [
                { src: 'dist/*', dest: '../browser/react/dist' },
                { src: 'src/*', dest: '../browser/react/src' },
                { src: 'surveys', dest: '../browser/react' },
                { src: 'slim', dest: '../browser/react' },
            ],
        }),
    ],
}

export default [
    buildEsm,
    buildUmd,
    buildTypes,
    buildSlimEsm,
    buildSlimUmd,
    buildSlimTypes,
    buildSurveysEsm,
    buildSurveysUmd,
    buildSurveysTypes,
]
