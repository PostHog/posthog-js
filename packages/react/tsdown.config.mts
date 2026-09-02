import * as remappingModule from '@ampproject/remapping'
import type { SourceMap, SourceMapInput, SourceMapLoader } from '@ampproject/remapping'
import ts from 'typescript'
import { defineConfig, type CopyEntry, type CopyOptions, type Rolldown, type UserConfig } from 'tsdown'

const remapping = remappingModule.default as unknown as (
    input: SourceMapInput | SourceMapInput[],
    loader: SourceMapLoader
) => SourceMap
const external = ['posthog-js', 'react']

// The configs share nested output trees and run in parallel, so the package script cleans once up front.
const clean = false

// Rolldown intentionally supports ES2015 and newer. @posthog/react still publishes ES5 syntax, so
// downlevel each completed runtime chunk and compose that transform with Rolldown's source map.
const es5CompatibilityPlugin = {
    name: 'posthog-react-es5-compatibility',
    generateBundle(_options: unknown, bundle: Rolldown.OutputBundle) {
        Object.values(bundle).forEach((output) => {
            if (output.type !== 'chunk') {
                return
            }

            let code = output.code

            // Rolldown does not expose Rollup's `interop: 'compat'`. Restore the same UMD
            // default-import behavior for CommonJS posthog-js namespaces before downleveling.
            const interopPattern = /posthog_js\s*=\s*__toESM\(posthog_js\);/u
            if (interopPattern.test(code)) {
                code = code.replace(
                    interopPattern,
                    'posthog_js = posthog_js && typeof posthog_js === "object" && "default" in posthog_js ? posthog_js : { default: posthog_js };'
                )
            }

            const result = ts.transpileModule(code, {
                fileName: output.fileName,
                compilerOptions: {
                    allowJs: true,
                    module: ts.ModuleKind.ES2015,
                    sourceMap: true,
                    target: ts.ScriptTarget.ES5,
                },
            })
            const downlevelMap = result.sourceMapText ? JSON.parse(result.sourceMapText) : null

            output.code = result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '')
            output.map = output.map && downlevelMap ? remapping([downlevelMap, output.map], () => null) : downlevelMap
        })
    },
}

const copiedOutput = (from: string | string[]): CopyEntry => ({
    from,
    to: '../browser/react/dist',
    flatten: false,
})

const runtimeBuild = (
    entry: string,
    globalName: string,
    esmOutDir: string,
    umdOutDir: string,
    copy: CopyOptions
): UserConfig => ({
    entry: { index: entry },
    format: {
        esm: { outDir: esmOutDir },
        umd: { outDir: umdOutDir },
    },
    globalName,
    platform: 'browser',
    target: 'es2015',
    clean,
    sourcemap: true,
    dts: false,
    plugins: [es5CompatibilityPlugin],
    deps: {
        neverBundle: external,
        onlyImport: external,
    },
    outputOptions: {
        entryFileNames: 'index.js',
        globals: {
            react: 'React',
            'posthog-js': 'posthog',
        },
    },
    copy,
})

const typeBuild = (entry: string, outDir: string, copy: CopyOptions): UserConfig => ({
    entry: { index: entry },
    format: 'esm',
    outDir,
    platform: 'browser',
    clean,
    dts: { emitDtsOnly: true },
    outExtensions: () => ({ dts: '.d.ts' }),
    deps: {
        neverBundle: external,
        onlyImport: external,
    },
    copy,
})

export default defineConfig([
    runtimeBuild('src/index.ts', 'PosthogReact', 'dist/esm', 'dist/umd', [
        copiedOutput(['dist/esm/index.js*', 'dist/umd/index.js*']),
    ]),
    runtimeBuild('src/slim.ts', 'PosthogReactSlim', 'dist/esm/slim', 'dist/umd/slim', [
        copiedOutput(['dist/esm/slim/index.js*', 'dist/umd/slim/index.js*']),
    ]),
    runtimeBuild('src/surveys/index.ts', 'PosthogReactSurveys', 'dist/esm/surveys', 'dist/umd/surveys', [
        copiedOutput(['dist/esm/surveys/index.js*', 'dist/umd/surveys/index.js*']),
    ]),
    typeBuild('src/index.ts', 'dist/types', [
        copiedOutput('dist/types/index.d.ts'),
        { from: 'src/**/*', to: '../browser/react/src', flatten: false },
    ]),
    typeBuild('src/slim.ts', 'dist/types/slim', [
        copiedOutput('dist/types/slim/index.d.ts'),
        { from: 'slim/**/*', to: '../browser/react/slim', flatten: false },
    ]),
    typeBuild('src/surveys/index.ts', 'dist/types/surveys', [
        copiedOutput('dist/types/surveys/index.d.ts'),
        { from: 'surveys/**/*', to: '../browser/react/surveys', flatten: false },
    ]),
])
