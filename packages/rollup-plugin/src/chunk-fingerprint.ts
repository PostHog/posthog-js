import type { RenderedChunk } from 'rollup'
import path from 'node:path'

const HASH_PLACEHOLDER = /!~\{[\w$]+\}~/g

function chunkIdentity(chunk: RenderedChunk) {
    const moduleId = (id: string) =>
        path.isAbsolute(id) ? path.relative(process.cwd(), id).split(path.sep).join('/') : id
    return {
        facadeModuleId: chunk.facadeModuleId ? moduleId(chunk.facadeModuleId) : null,
        moduleIds: chunk.moduleIds.map(moduleId).sort(),
    }
}

export function chunkFingerprint(code: string, chunk: RenderedChunk, chunks?: Record<string, RenderedChunk>): string {
    if (!chunks) return code

    const identities = new Map<string, ReturnType<typeof chunkIdentity>>()
    for (const fileName of new Set([
        chunk.fileName,
        ...chunk.imports,
        ...chunk.dynamicImports,
        ...(chunk.referencedFiles ?? []),
        ...(chunk.implicitlyLoadedBefore ?? []),
    ])) {
        const dependency = chunks[fileName]
        if (!dependency || (!dependency.facadeModuleId && dependency.moduleIds.length === 0)) continue
        for (const [placeholder] of fileName.matchAll(HASH_PLACEHOLDER)) {
            identities.set(placeholder, chunkIdentity(dependency))
        }
    }

    // Only the fingerprint is canonicalized. The bundler must still resolve the original
    // placeholders in emitted code. Keep dependency identity and hash width: stripping ordinals
    // alone aliases different anonymous chunks, and different widths can shift mapped columns.
    const parts: (string | { chunk: ReturnType<typeof chunkIdentity>; hashLength: number })[] = []
    let at = 0
    for (const match of code.matchAll(HASH_PLACEHOLDER)) {
        const identity = identities.get(match[0])
        if (!identity) continue
        parts.push(code.slice(at, match.index), { chunk: identity, hashLength: match[0].length })
        at = match.index + match[0].length
    }
    if (at === 0) return code
    parts.push(code.slice(at))
    return JSON.stringify(['posthog-chunk-fingerprint-v1', chunkIdentity(chunk), parts])
}
