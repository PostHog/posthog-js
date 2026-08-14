import * as crypto from 'crypto'

/**
 * Returns the minified chunk-id IIFE the SDK reads at runtime to map an
 * error's stack back to a chunk id.
 *
 * Byte-for-byte contract with posthog-cli (`CODE_SNIPPET_TEMPLATE` in
 * cli/src/sourcemaps/constant.rs): the CLI recognizes and removes previously
 * injected snippets by exact substring match, so any change here must ship in
 * the CLI constants too. Covered by a parity test in chunk-ids.spec.ts.
 */
export function createChunkIdSnippet(chunkId: string): string {
    return `!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]="${chunkId}")}catch(e){}}();`
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
