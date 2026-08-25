import * as crypto from 'crypto'

/**
 * Returns the minified chunk-id IIFE the SDK reads at runtime to map an
 * error's stack back to a chunk id. With `releaseId`, the snippet also pins
 * `_posthogReleaseId` on the global so the SDK emits the release on every
 * exception (first write wins, so the first loaded chunk decides).
 *
 * Byte-for-byte contract with posthog-cli (`CODE_SNIPPET_TEMPLATE` and
 * `CODE_SNIPPET_WITH_RELEASE_TEMPLATE` in cli/src/sourcemaps/constant.rs): the
 * CLI recognizes and removes previously injected snippets by exact substring
 * match, so any change here must ship in the CLI constants too. Ids are
 * JSON-encoded for the same reason the CLI encodes them: an id carrying a quote
 * would otherwise break out of the string literal. Covered by a parity test in
 * chunk-ids.spec.ts.
 */
export function createChunkIdSnippet(chunkId: string, releaseId?: string): string {
    const chunk = JSON.stringify(chunkId)
    if (releaseId === undefined) {
        return `!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]=${chunk})}catch(e){}}();`
    }
    return `!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{};e._posthogReleaseId=e._posthogReleaseId||${JSON.stringify(releaseId)};var n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]=${chunk})}catch(e){}}();`
}

/**
 * Returns the comment posthog-cli discovers chunk ids from at upload time
 * (`CHUNKID_COMMENT_PREFIX` in cli/src/sourcemaps/constant.rs), including the
 * leading newline the CLI's exact-match removal expects.
 */
export function createChunkIdComment(chunkId: string): string {
    return `\n//# chunkId=${chunkId}`
}

/**
 * Mints a fresh random chunk id: a new id per chunk, per build.
 */
export function createChunkId(): string {
    return crypto.randomUUID()
}

// Fixed namespace for content-addressed chunk ids, matching `CHUNK_ID_NAMESPACE` in
// cli/src/sourcemaps/constant.rs. Both sides must derive ids from the same namespace, or a
// dist processed by one tool and re-processed by the other would upload the same code twice.
const CHUNK_ID_NAMESPACE = '0e9b3c7a-5d1f-42a8-b6c4-e2d0f8a17593'

/**
 * Derives a chunk id from the chunk's own bytes (UUIDv5), so identical code keeps its id across
 * rebuilds and re-uploads dedupe against the symbol set already stored. Used in event release
 * mode, where the release travels inside the chunk instead of being bound to the symbol set, so
 * a per-build random id would create a fresh symbol set on every build.
 *
 * The id is content-addressed over what `renderChunk` sees. posthog-cli derives its own ids from
 * the file on disk, which by then also carries the trailing `sourceMappingURL` comment, so the
 * same chunk gets a different (but equally stable) id depending on which tool injected it.
 */
export function createStableChunkId(code: string): string {
    const namespace = Buffer.from(CHUNK_ID_NAMESPACE.replace(/-/g, ''), 'hex')
    const hash = crypto.createHash('sha1').update(namespace).update(code, 'utf8').digest()

    // RFC 4122: version in the high nibble of byte 6, variant in the top two bits of byte 8.
    hash[6] = (hash[6] & 0x0f) | 0x50
    hash[8] = (hash[8] & 0x3f) | 0x80

    const hex = hash.subarray(0, 16).toString('hex')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

// Anchored with a bounded quantifier and only ever run against a fixed-size
// window: an unbounded regex over the whole bundle is quadratic on adversarial
// input (a match attempt per marker occurrence, each scanning ahead).
const COMMENT_REGEX = /^\/\/# chunkId=(\S{1,128})/
const COMMENT_MARKER = '//# chunkId='
const WINDOW = 256

/**
 * Extracts the chunk id from source that already carries one, using the same
 * detection the CLI uses: a `//# chunkId=` comment at the start of a line.
 * The injected IIFE is deliberately not matched — its marker text can appear
 * inside string literals of bundled code (docs strings, bundled PostHog
 * tooling), and the CLI only ever reads the line-anchored comment. Keeping the
 * two in sync guarantees this returning an id ⟺ the CLI finding one.
 */
export function determineChunkIdFromSource(code: string): string | undefined {
    for (
        let at = code.indexOf(COMMENT_MARKER);
        at !== -1;
        at = code.indexOf(COMMENT_MARKER, at + COMMENT_MARKER.length)
    ) {
        if (at !== 0 && code[at - 1] !== '\n') continue
        const match = COMMENT_REGEX.exec(code.slice(at, at + WINDOW))
        if (match) {
            return match[1]
        }
    }
    return undefined
}
