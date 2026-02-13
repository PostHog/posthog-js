import { resolve, typescript, commonjs, dts } from '@posthog-tooling/rollup-utils'
import copy from 'rollup-plugin-copy'

const fileExtensions = ['.js', '.jsx', '.ts', '.tsx']

const plugins = [
    // Resolve modules from node_modules
    resolve({
        preferBuiltins: false,
        mainFields: ['module', 'main', 'jsnext:main', 'browser'],
        extensions: fileExtensions,
    }),
    commonjs(),
    // Compile typescript to javascript
    typescript({
        tsconfig: './tsconfig.json',
    }),
]

const extensions = [
    { name: 'surveys', umdName: 'PosthogReactSurveys' },
    { name: 'product-tours', umdName: 'PosthogReactProductTours' },
]

function buildExtension({ name, umdName }, isLast) {
    const esm = {
        external: ['posthog-js', 'react'],
        input: `src/extensions/${name}/index.ts`,
        output: {
            file: `dist/esm/${name}/index.js`,
            format: 'esm',
            sourcemap: true,
        },
        plugins,
    }

    const umd = {
        external: ['posthog-js', 'react'],
        input: `src/extensions/${name}/index.ts`,
        output: {
            file: `dist/umd/${name}/index.js`,
            name: umdName,
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

    const typesPlugins = [resolve(), dts()]
    if (isLast) {
        typesPlugins.push(
            copy({
                hook: 'writeBundle',
                targets: [
                    { src: 'dist/*', dest: '../browser/react/dist' },
                    { src: 'src/*', dest: '../browser/react/src' },
                    ...extensions.map((ext) => ({ src: ext.name, dest: '../browser/react' })),
                ],
            })
        )
    }

    const types = {
        external: ['posthog-js', 'react'],
        input: `src/extensions/${name}/index.ts`,
        output: {
            file: `dist/types/${name}/index.d.ts`,
            format: 'es',
        },
        plugins: typesPlugins,
    }

    return [esm, umd, types]
}

const buildEsm = {
    external: ['posthog-js', 'react'],
    input: ['src/index.ts'],
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

export default [
    buildEsm,
    buildUmd,
    buildTypes,
    ...extensions.flatMap((ext, i) => buildExtension(ext, i === extensions.length - 1)),
]
