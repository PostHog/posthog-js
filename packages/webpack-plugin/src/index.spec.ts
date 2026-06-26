import { spawnSync } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { pathToFileURL } from 'url'
import type webpack from 'webpack'
import { runSourcemapCli } from '@posthog/plugin-utils'
import { PosthogWebpackPlugin } from './index'
import type { ResolvedPluginConfig } from './config'

const mockLoggerError = jest.fn()

jest.mock(
    '@posthog/core',
    () => ({
        createLogger: () => ({ error: mockLoggerError }),
    }),
    { virtual: true }
)

jest.mock('@posthog/plugin-utils', () => ({
    runSourcemapCli: jest.fn().mockResolvedValue(undefined),
}))

const runSourcemapCliMock = runSourcemapCli as jest.MockedFunction<typeof runSourcemapCli>

const config: ResolvedPluginConfig = {
    personalApiKey: 'phx_test',
    projectId: '1',
    host: 'https://us.i.posthog.com',
    logLevel: 'info',
    cliBinaryPath: 'posthog-cli',
    sourcemaps: {
        enabled: true,
        deleteAfterUpload: true,
    },
}

type TestAsset = { name: string }
type TestChunk = { files: Set<string> }

function createCompilation(outputDirectory: string, chunks: TestChunk[], assets: TestAsset[]): webpack.Compilation {
    return {
        outputOptions: { path: outputDirectory },
        chunks: new Set(chunks),
        getAssets: () => assets,
    } as unknown as webpack.Compilation
}

async function exists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath)
        return true
    } catch {
        return false
    }
}

function runNodeScript(cwd: string, args: string[]): string {
    const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' })

    if (result.error || result.status !== 0) {
        throw new Error(`Node script failed:\n${result.error?.message ?? ''}\n${result.stderr}\n${result.stdout}`)
    }

    return result.stdout
}

async function getRuntimeSourceFiles(directory = __dirname, prefix = 'src'): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true })
    const files = await Promise.all(
        entries.map(async (entry) => {
            const entryPath = path.join(directory, entry.name)
            const relativePath = path.posix.join(prefix, entry.name)

            if (entry.isDirectory()) {
                return getRuntimeSourceFiles(entryPath, relativePath)
            }

            if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
                return [relativePath]
            }

            return []
        })
    )

    return files.flat().sort()
}

function getRslibConfig(packageDirectory: string): { entryFiles: string[]; formats: string[] } {
    const configPath = path.join(packageDirectory, 'rslib.config.mjs')
    const script = [
        `const config = (await import(${JSON.stringify(pathToFileURL(configPath).href)})).default`,
        'const resolvedConfig = await Promise.resolve(config)',
        'const payload = {',
        '  entry: resolvedConfig.source.entry,',
        '  formats: resolvedConfig.lib.map(({ format }) => format),',
        '}',
        'process.stdout.write(JSON.stringify(payload))',
    ].join('\n')
    const stdout = runNodeScript(packageDirectory, ['--input-type=module', '--eval', script])
    const config = JSON.parse(stdout) as { entry: Record<string, string | string[]>; formats: string[] }

    return {
        entryFiles: Object.values(config.entry)
            .flat()
            .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts'))
            .sort(),
        formats: config.formats.sort(),
    }
}

async function createResolvablePackage(packageDirectory: string): Promise<{ exports: Record<string, unknown> }> {
    const packageJson = JSON.parse(await fs.readFile(path.resolve(__dirname, '../package.json'), 'utf8')) as {
        exports: Record<string, unknown>
    }
    const packageRoot = path.join(packageDirectory, 'node_modules/@posthog/webpack-plugin')

    await fs.mkdir(path.join(packageRoot, 'dist'), { recursive: true })
    await fs.writeFile(path.join(packageRoot, 'package.json'), JSON.stringify(packageJson, null, 4))
    await fs.writeFile(path.join(packageRoot, 'dist/config.js'), "module.exports = { marker: 'cjs-config' }\n")
    await fs.writeFile(path.join(packageRoot, 'dist/config.mjs'), "export const marker = 'esm-config'\n")
    await fs.writeFile(path.join(packageRoot, 'dist/config.d.ts'), 'export declare const marker: string\n')

    return packageJson
}

describe('PosthogWebpackPlugin', () => {
    let outputDirectory: string

    beforeEach(async () => {
        runSourcemapCliMock.mockClear()
        mockLoggerError.mockClear()
        outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'posthog-webpack-plugin-'))
    })

    afterEach(async () => {
        jest.restoreAllMocks()
        await fs.rm(outputDirectory, { force: true, recursive: true })
    })

    it('builds every runtime source file as CJS and ESM package entrypoints', async () => {
        const packageDirectory = path.resolve(__dirname, '..')
        const rslibConfig = getRslibConfig(packageDirectory)

        expect(rslibConfig.entryFiles).toEqual(await getRuntimeSourceFiles())
        expect(rslibConfig.formats).toEqual(expect.arrayContaining(['cjs', 'esm']))
    })

    it('exposes the config subpath to package consumers', async () => {
        const packageJson = await createResolvablePackage(outputDirectory)

        expect(packageJson.exports['./config']).toEqual({
            require: './dist/config.js',
            import: './dist/config.mjs',
            types: './dist/config.d.ts',
        })
        runNodeScript(outputDirectory, [
            '--eval',
            [
                "const config = require('@posthog/webpack-plugin/config')",
                "if (config.marker !== 'cjs-config') throw new Error('CJS config export did not resolve')",
            ].join('; '),
        ])
        runNodeScript(outputDirectory, [
            '--input-type=module',
            '--eval',
            [
                "const config = await import('@posthog/webpack-plugin/config')",
                "if (config.marker !== 'esm-config') throw new Error('ESM config export did not resolve')",
            ].join('; '),
        ])
    })

    it.each([
        {
            deleteAfterUpload: true,
            expectedExists: false,
            label: 'deletes emitted CSS source maps after upload when deleteAfterUpload is enabled',
        },
        {
            deleteAfterUpload: false,
            expectedExists: true,
            label: 'keeps emitted CSS source maps after upload when deleteAfterUpload is disabled',
        },
    ])('$label', async ({ deleteAfterUpload, expectedExists }) => {
        const cssSourceMap = path.join(outputDirectory, 'static/css/app.css.map')
        await fs.mkdir(path.dirname(cssSourceMap), { recursive: true })
        await fs.writeFile(cssSourceMap, '{}')

        const testConfig = {
            ...config,
            sourcemaps: {
                ...config.sourcemaps,
                deleteAfterUpload,
            },
        }
        const plugin = new PosthogWebpackPlugin(testConfig, true)
        const compilation = createCompilation(
            outputDirectory,
            [{ files: new Set(['static/chunks/app.js']) }],
            [{ name: 'static/css/app.css.map' }]
        )

        await plugin.processSourceMaps(compilation, testConfig)

        expect(await exists(cssSourceMap)).toBe(expectedExists)
    })

    it('continues deleting CSS source maps and logs each deletion failure', async () => {
        const originalRm = fs.rm.bind(fs)
        const failedCssSourceMap = path.join(outputDirectory, 'static/css/app.css.map')
        const deletedCssSourceMap = path.join(outputDirectory, 'static/css/vendor.css.map')
        await fs.mkdir(path.dirname(failedCssSourceMap), { recursive: true })
        await fs.writeFile(failedCssSourceMap, '{}')
        await fs.writeFile(deletedCssSourceMap, '{}')

        jest.spyOn(fs, 'rm').mockImplementation(async (filePath, options) => {
            if (filePath === failedCssSourceMap) {
                throw new Error('permission denied')
            }

            return originalRm(filePath, options)
        })

        const plugin = new PosthogWebpackPlugin(config, true)
        const compilation = createCompilation(
            outputDirectory,
            [{ files: new Set(['static/chunks/app.js']) }],
            [{ name: 'static/css/app.css.map' }, { name: 'static/css/vendor.css.map' }]
        )

        await plugin.processSourceMaps(compilation, config)

        expect(await exists(failedCssSourceMap)).toBe(true)
        expect(await exists(deletedCssSourceMap)).toBe(false)
        expect(mockLoggerError).toHaveBeenCalledWith(
            'PostHog sourcemaps uploaded, but failed to delete CSS source map:',
            failedCssSourceMap,
            'permission denied'
        )
    })
})
