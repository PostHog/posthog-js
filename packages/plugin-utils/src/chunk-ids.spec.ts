import { createChunkId, createChunkIdComment, createChunkIdSnippet, determineChunkIdFromSource } from './chunk-ids'

// Mirrors cli/src/sourcemaps/constant.rs in PostHog/posthog. The CLI de-duplicates
// and removes injected snippets by exact substring match, so the JS and Rust
// templates must stay byte-identical — update both sides together.
const CLI_CODE_SNIPPET_TEMPLATE = `!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]="__POSTHOG_CHUNK_ID__")}catch(e){}}();`
const CLI_CHUNKID_COMMENT_PREFIX = '\n//# chunkId=__POSTHOG_CHUNK_ID__'
const CLI_CHUNKID_PLACEHOLDER = '__POSTHOG_CHUNK_ID__'

describe('chunk-ids', () => {
    it('emits the snippet byte-identical to the posthog-cli template', () => {
        expect(createChunkIdSnippet(CLI_CHUNKID_PLACEHOLDER)).toBe(CLI_CODE_SNIPPET_TEMPLATE)
    })

    it('emits the chunk id comment byte-identical to the posthog-cli template', () => {
        expect(createChunkIdComment(CLI_CHUNKID_PLACEHOLDER)).toBe(CLI_CHUNKID_COMMENT_PREFIX)
    })

    it('mints a fresh uuid chunk id per call', () => {
        const id = createChunkId()

        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
        expect(createChunkId()).not.toBe(id)
    })

    it('finds the chunk id in injected code', () => {
        const id = createChunkId()
        const code = `${createChunkIdSnippet(id)}console.log("app")${createChunkIdComment(id)}`

        expect(determineChunkIdFromSource(code)).toBe(id)
    })

    it('finds the chunk id when only the CLI comment is present', () => {
        expect(determineChunkIdFromSource('console.log("app")\n//# chunkId=abc-123')).toBe('abc-123')
    })

    it('returns undefined for untouched code', () => {
        expect(determineChunkIdFromSource('console.log("app")')).toBeUndefined()
    })

    it('ignores marker text inside string literals', () => {
        expect(
            determineChunkIdFromSource('const docs = "append a //# chunkId=abc123 comment to the chunk";')
        ).toBeUndefined()
        expect(determineChunkIdFromSource('var log = "_posthogChunkIds[";')).toBeUndefined()
    })

    it('does not treat the IIFE alone as injected — only the line-anchored comment counts, like the CLI', () => {
        expect(determineChunkIdFromSource(createChunkIdSnippet('abc-123'))).toBeUndefined()
    })

    it('finds a comment at the very start of the source', () => {
        expect(determineChunkIdFromSource('//# chunkId=abc-123')).toBe('abc-123')
    })

    it('stays fast on adversarial marker repetitions', () => {
        expect(determineChunkIdFromSource('\n//# chunkId= '.repeat(50_000))).toBeUndefined()
    })
})
