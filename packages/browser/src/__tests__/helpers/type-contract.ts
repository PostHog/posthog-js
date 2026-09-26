import * as ts from 'typescript'

export const typeContractDiagnostics = (fixture: string, source: string): string[] => {
    const options: ts.CompilerOptions = {
        noEmit: true,
        strict: true,
        skipLibCheck: true,
        types: [],
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
    }
    const host = ts.createCompilerHost(options)
    const getSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) =>
        file === fixture
            ? ts.createSourceFile(file, source, languageVersion, true)
            : getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
    const program = ts.createProgram([fixture], options, host)
    const fixtureSource = program.getSourceFile(fixture)
    if (!fixtureSource) throw new Error(`Missing type-contract fixture: ${fixture}`)

    // This checks the consumer fixture; package source remains covered by the production typecheck.
    return [
        ...program.getOptionsDiagnostics(),
        ...program.getGlobalDiagnostics(),
        ...program.getSyntacticDiagnostics(fixtureSource),
        ...program.getSemanticDiagnostics(fixtureSource),
    ].map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}
