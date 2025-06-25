/*eslint-env node */

import babel from '@rollup/plugin-babel'
import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'
import json from '@rollup/plugin-json'
import typescript from 'rollup-plugin-typescript2'
import { Plugin } from 'rollup'

export { default as babel } from '@rollup/plugin-babel'
export { default as commonjs } from '@rollup/plugin-commonjs'
export { default as resolve } from '@rollup/plugin-node-resolve'
export { default as json } from '@rollup/plugin-json'
export { default as typescript } from 'rollup-plugin-typescript2'
export { default as dts } from 'rollup-plugin-dts'

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
    return Array.from(externals)
}
