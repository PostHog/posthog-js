import { stdout } from 'node:process'
import { rspack } from '@rspack/core'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const compiler = rspack({
    mode: 'production',
    context: root,
    target: ['web', 'es2022'],
    entry: { posthog: './snippet/entry.ts' },
    devtool: 'source-map',
    output: {
        path: `${root}dist-cdn`,
        filename: 'posthog.js',
        chunkFilename: 'chunks/[name].[contenthash:16].js',
        publicPath: 'auto',
        uniqueName: `posthog-browser-${version}`,
        clean: true,
    },
    resolve: { extensions: ['.ts', '.js', '.mjs'] },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                loader: 'builtin:swc-loader',
                options: { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' } },
            },
        ],
    },
    plugins: [new rspack.DefinePlugin({ __POSTHOG_BROWSER_VERSION__: JSON.stringify(version) })],
    optimization: { splitChunks: { chunks: 'async' } },
})

try {
    const stats = await new Promise((resolve, reject) => {
        compiler.run((error, stats) => (error ? reject(error) : resolve(stats)))
    })
    if (stats.hasErrors()) throw new Error(stats.toString({ colors: false }))
    // Attribution is local build evidence, not a CDN release asset.
    await mkdir(`${root}.playwright`, { recursive: true })
    await writeFile(
        `${root}.playwright/cdn-stats.json`,
        JSON.stringify(
            stats.toJson({
                all: false,
                chunks: true,
                chunkModules: true,
                nestedModules: true,
                assets: true,
                modules: true,
                dependentModules: true,
                orphanModules: true,
                groupModulesByAttributes: false,
                groupModulesByType: false,
                groupModulesByPath: false,
                groupModulesByExtension: false,
                chunkModulesSpace: Infinity,
                nestedModulesSpace: Infinity,
            })
        )
    )
    stdout.write(stats.toString({ colors: false, modules: false, chunks: false }) + '\n')
} finally {
    await new Promise((resolve, reject) => compiler.close((error) => (error ? reject(error) : resolve())))
}
