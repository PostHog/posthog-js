import type { RenderedChunk } from 'rollup'
import path from 'node:path'
import { createStableChunkId } from '@posthog/plugin-utils'
import { chunkFingerprint } from './chunk-fingerprint'

function chunk(fileName: string, moduleId: string, extra: Partial<RenderedChunk> = {}): RenderedChunk {
    return {
        type: 'chunk',
        name: 'chunk',
        fileName,
        facadeModuleId: null,
        moduleIds: [path.resolve(moduleId)],
        modules: {},
        imports: [],
        dynamicImports: [],
        implicitlyLoadedBefore: [],
        referencedFiles: [],
        importedBindings: {},
        exports: [],
        isEntry: false,
        isDynamicEntry: false,
        isImplicitEntry: false,
        ...extra,
    }
}

function id(code: string, entry: RenderedChunk, dependencies: RenderedChunk[]): string {
    const chunks = Object.fromEntries([entry, ...dependencies].map((item) => [item.fileName, item]))
    return createStableChunkId(chunkFingerprint(code, entry, chunks))
}

describe('chunkFingerprint', () => {
    it('preserves dependency identity when static and dynamic import placeholders are renumbered', () => {
        const a = chunk('chunk-!~{001}~.js', 'a.js')
        const b = chunk('chunk-!~{002}~.js', 'b.js')
        const entry = chunk('entry.js', 'entry.js', { imports: [a.fileName], dynamicImports: [b.fileName] })
        const code = `import './${a.fileName}'; const load = () => import('./${b.fileName}');`
        const renumberedA = { ...a, fileName: b.fileName }
        const renumberedB = { ...b, fileName: a.fileName }
        const rebuilt = { ...entry, imports: [renumberedA.fileName], dynamicImports: [renumberedB.fileName] }
        const rebuiltCode = `import './${renumberedA.fileName}'; const load = () => import('./${renumberedB.fileName}');`

        expect(id(rebuiltCode, rebuilt, [renumberedA, renumberedB])).toBe(id(code, entry, [a, b]))
        expect(id(code, entry, [renumberedA, renumberedB])).not.toBe(id(code, entry, [a, b]))
    })

    it('distinguishes different dependencies behind the same anonymous filename', () => {
        const dependency = chunk('chunk-!~{001}~.js', 'a.js')
        const entry = chunk('entry.js', 'entry.js', { imports: [dependency.fileName] })
        const code = `import './${dependency.fileName}';`

        expect(id(code, entry, [chunk(dependency.fileName, 'b.js')])).not.toBe(id(code, entry, [dependency]))
    })

    it('preserves source identity and hash width so incompatible map layouts cannot share an id', () => {
        const dependency = chunk('chunk-!~{001}~.js', 'a.js')
        const entry = chunk('entry.js', 'entry.js', { imports: [dependency.fileName] })
        const code = `import './${dependency.fileName}'; run();`
        const longer = { ...dependency, fileName: 'chunk-!~{00001}~.js' }

        expect(id(code, { ...entry, moduleIds: [path.resolve('other-entry.js')] }, [dependency])).not.toBe(
            id(code, entry, [dependency])
        )
        expect(
            id(`import './${longer.fileName}'; run();`, { ...entry, imports: [longer.fileName] }, [longer])
        ).not.toBe(id(code, entry, [dependency]))
    })

    it('leaves unknown placeholders and chunks without hash references byte-addressed', () => {
        const entry = chunk('entry.js', 'entry.js')
        const code = "console.log('!~{001}~');"
        expect(chunkFingerprint(code, entry, { [entry.fileName]: entry })).toBe(code)
        expect(chunkFingerprint(code, entry)).toBe(code)
        expect(chunkFingerprint('run();', entry, { [entry.fileName]: entry })).toBe('run();')
    })

    it('does not canonicalize a dependency without a stable module identity', () => {
        const dependency = chunk('chunk-!~{001}~.js', 'unused.js', { moduleIds: [] })
        const entry = chunk('entry.js', 'entry.js', { imports: [dependency.fileName] })
        const code = `import './${dependency.fileName}';`

        expect(chunkFingerprint(code, entry, { [entry.fileName]: entry, [dependency.fileName]: dependency })).toBe(code)
    })
})
