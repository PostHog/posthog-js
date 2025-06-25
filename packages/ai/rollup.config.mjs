import { external, babel, resolve, commonjs, json, dts, plugins } from '@posthog-tooling/rollup-utils'
import packageJson from './package.json' with { type: 'json' }

const configs = []
const extensions = ['.js', '.jsx', '.ts', '.tsx']
const externalDeps = external(packageJson)

configs.push({
    input: `./index.ts`,
    output: [
        {
            file: packageJson.main,
            sourcemap: true,
            exports: 'named',
            format: `cjs`,
        },
        {
            file: packageJson.module,
            sourcemap: true,
            format: `es`,
        },
    ],
    external: externalDeps,
    plugins: plugins(extensions),
})

configs.push({
    input: `./index.ts`,
    output: [{ file: `./lib/index.d.ts`, format: 'es' }],
    external: externalDeps,
    plugins: [resolve({ extensions }), dts()],
})

// Add submodule builds for posthog-ai
const providers = ['anthropic', 'openai', 'vercel', 'langchain']

providers.forEach((provider) => {
    configs.push({
        input: `./src/${provider}/index.ts`,
        output: [
            {
                file: `./lib/${provider}/index.cjs`,
                sourcemap: true,
                exports: 'named',
                format: 'cjs',
            },
            {
                file: `./lib/${provider}/index.mjs`,
                sourcemap: true,
                format: 'es',
            },
        ],
        external: externalDeps,
        plugins: [
            resolve({ extensions }),
            commonjs(),
            json(),
            babel({
                extensions,
                babelHelpers: 'bundled',
                include: ['./src/**/*.{js,jsx,ts,tsx}'],
                presets: [
                    ['@babel/preset-env', { targets: { node: 'current' } }],
                    '@babel/preset-typescript',
                    '@babel/preset-react',
                ],
            }),
        ],
    })

    configs.push({
        input: `./src/${provider}/index.ts`,
        output: [{ file: `./lib/${provider}/index.d.ts`, format: 'es' }],
        external: externalDeps,
        plugins: [resolve({ extensions }), dts()],
    })
})

export default configs
