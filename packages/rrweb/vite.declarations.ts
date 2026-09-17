import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { rolldown, type RolldownOptions, type OutputOptions } from 'rolldown'
import ts from 'typescript'
import type { Plugin } from '../../tooling/rrweb-build/index'

/** Use the production declaration config in Vite, including all secondary entries and shims. */
export function watchDeclarations(configFile = 'rolldown.dts.config.mts', always = false): Plugin {
    let enabled = false
    let checking: ts.SemanticDiagnosticsBuilderProgram | undefined
    const formatHost: ts.FormatDiagnosticsHost = {
        getCanonicalFileName: (file) => file,
        getCurrentDirectory: ts.sys.getCurrentDirectory,
        getNewLine: () => ts.sys.newLine,
    }
    let configs: (RolldownOptions & { output: OutputOptions })[]
    return {
        name: 'rrweb-oxc-declarations',
        configResolved(config) {
            enabled = always || Boolean(config.build.watch)
        },
        async buildStart() {
            if (!enabled) return
            // Oxc only emits declarations. Check the whole TS project, and watch even source
            // files that contribute no runtime code or exported declarations. Reuse the builder
            // across rebuilds without a second watcher or process to shut down.
            const parsed = ts.getParsedCommandLineOfConfigFile(
                'tsconfig.json',
                { noEmit: true },
                {
                    ...ts.sys,
                    readFile: (file) => {
                        this.addWatchFile(path.resolve(file))
                        return ts.sys.readFile(file)
                    },
                    onUnRecoverableConfigFileDiagnostic: (diagnostic) =>
                        this.error(ts.formatDiagnostics([diagnostic], formatHost)),
                }
            )!
            checking = ts.createSemanticDiagnosticsBuilderProgram(
                parsed.fileNames,
                parsed.options,
                ts.createIncrementalCompilerHost(parsed.options),
                checking,
                undefined,
                parsed.projectReferences
            )
            this.addWatchFile(path.resolve('tsconfig.json'))
            for (const source of checking.getProgram().getSourceFiles()) this.addWatchFile(source.fileName)
            const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(checking.getProgram())]
            if (diagnostics.length) {
                const message = ts.formatDiagnostics(diagnostics, formatHost)
                if (!this.meta.watchMode) this.error(message)
                this.warn(message)
            }
            const configPath = path.resolve(configFile)
            this.addWatchFile(configPath)
            configs ??= (await import(pathToFileURL(configPath).href)).default
            for (const config of configs) {
                const build = await rolldown(config)
                try {
                    const { output } = await build.generate(config.output)
                    for (const file of output) {
                        const source = file.type === 'asset' ? file.source : file.code
                        this.emitFile({ type: 'asset', fileName: file.fileName, source })
                        if (file.fileName.endsWith('.d.ts')) {
                            this.emitFile({
                                type: 'asset',
                                fileName: file.fileName.replace(/\.d\.ts$/, '.d.cts'),
                                source,
                            })
                        }
                    }
                } finally {
                    // Also register files after an unsuccessful generation, so fixing an error rebuilds.
                    for (const file of await build.watchFiles) this.addWatchFile(file)
                    await build.close()
                }
            }
        },
        closeWatcher() {
            checking = undefined
        },
    }
}
