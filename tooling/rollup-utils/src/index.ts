import babel from '@rollup/plugin-babel'
import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import json from '@rollup/plugin-json'
import typescript from 'rollup-plugin-typescript2'
import dts from 'rollup-plugin-dts'
import type { Plugin } from 'rollup'

export const plugins = (extensions: string[]): Plugin[] => [
    // Allows node_modules resolution
    resolve({ extensions }),
    // Allow bundling cjs modules. Rollup doesn`t understand cjs
    commonjs(),
    json(),
    // Compile TypeScript/JavaScript files
    typescript({
        tsconfig: `./tsconfig.json`,
    }),
    babel({
        extensions,
        babelHelpers: 'bundled',
        include: [`./src/**/*`],
        presets: [
            ['@babel/preset-env', { targets: { node: 'current' } }],
            '@babel/preset-typescript',
            '@babel/preset-react',
        ],
    }),
]

function listDeps(deps: Record<string, string>) {
    return Object.keys(deps || {})
}

export function external(packageJson: any) {
    const externals: Set<string> = new Set([
        ...listDeps(packageJson.dependencies),
        ...listDeps(packageJson.peerDependencies),
        ...listDeps(packageJson.devDependencies),
    ])
    // posthog-core is internal for now
    // we will bundle it in other libraries for now
    if (externals.has('posthog-core')) {
        externals.delete('posthog-core')
    }
    return Array.from(externals)
}

export { babel }
export { commonjs }
export { resolve }
export { json }
export { typescript }
export { dts }
