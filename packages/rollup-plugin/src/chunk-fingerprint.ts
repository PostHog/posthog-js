import type { RenderedChunk } from 'rollup'
import path from 'node:path'
import { createStableChunkId } from '@posthog/plugin-utils'

const HASH_PLACEHOLDER = /!~\{[\w$]+\}~/g

function chunkIdentity(chunk: RenderedChunk) {
    const moduleId = (id: string) => {
        const virtualPrefix = id.startsWith('\0') ? '\0' : ''
        const filePath = virtualPrefix ? id.slice(1) : id
        return path.isAbsolute(filePath)
            ? `${virtualPrefix}${path.relative(process.cwd(), filePath).split(path.sep).join('/')}`
            : id
    }
    return {
        facadeModuleId: chunk.facadeModuleId ? moduleId(chunk.facadeModuleId) : null,
        moduleIds: chunk.moduleIds.map(moduleId).sort(),
    }
}

export function createChunkFingerprint() {
    // Both bundlers share meta.chunks across one output, including concurrent renderChunk calls.
    // Rolldown does not share the hook context, so it cannot own this cache.
    const identitiesByOutput = new WeakMap<Record<string, RenderedChunk>, Map<string, string>>()

    return (code: string, chunk: RenderedChunk, chunks?: Record<string, RenderedChunk>): string => {
        if (!chunks) return code

        let cachedIdentities = identitiesByOutput.get(chunks)
        if (!cachedIdentities) {
            cachedIdentities = new Map()
            identitiesByOutput.set(chunks, cachedIdentities)
        }
        const identityOf = (target: RenderedChunk) => {
            let identity = cachedIdentities.get(target.fileName)
            if (!identity) {
                identity = createStableChunkId(JSON.stringify(chunkIdentity(target)))
                cachedIdentities.set(target.fileName, identity)
            }
            return identity
        }

        const dependencies = new Map<string, RenderedChunk>()
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
                dependencies.set(placeholder, dependency)
            }
        }

        // Only the fingerprint is canonicalized. The bundler must still resolve the original
        // placeholders in emitted code. Keep dependency identity and hash width: stripping ordinals
        // alone aliases different anonymous chunks, and different widths can shift mapped columns.
        const parts: (string | { chunk: string; hashLength: number })[] = []
        let at = 0
        for (const match of code.matchAll(HASH_PLACEHOLDER)) {
            const dependency = dependencies.get(match[0])
            if (!dependency) continue
            parts.push(code.slice(at, match.index), { chunk: identityOf(dependency), hashLength: match[0].length })
            at = match.index + match[0].length
        }
        if (at === 0) return code
        parts.push(code.slice(at))
        return JSON.stringify(['posthog-chunk-fingerprint-v2', identityOf(chunk), parts])
    }
}
