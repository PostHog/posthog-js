import {
  computeChunkId,
  buildCodeSnippet,
  buildChunkComment,
  CHUNKID_PLACEHOLDER,
  CODE_SNIPPET_TEMPLATE,
  CHUNKID_COMMENT_PREFIX,
} from './chunk-id'

describe('chunk-id', () => {
  describe('computeChunkId', () => {
    it('returns a 32-char hex string', () => {
      const result = computeChunkId('console.log("hello")', '{"mappings":"AAAA"}')
      expect(result).toHaveLength(32)
      expect(result).toMatch(/^[0-9a-f]{32}$/)
    })

    it('is deterministic for the same input', () => {
      const js = 'var x = 1;'
      const map = '{"mappings":"AAAA"}'
      expect(computeChunkId(js, map)).toBe(computeChunkId(js, map))
    })

    it('changes when JS content changes', () => {
      const map = '{"mappings":"AAAA"}'
      const id1 = computeChunkId('var x = 1;', map)
      const id2 = computeChunkId('var x = 2;', map)
      expect(id1).not.toBe(id2)
    })

    it('changes when source map content changes', () => {
      const js = 'var x = 1;'
      const id1 = computeChunkId(js, '{"mappings":"AAAA"}')
      const id2 = computeChunkId(js, '{"mappings":"BBBB"}')
      expect(id1).not.toBe(id2)
    })

    it('accepts Buffer inputs', () => {
      const js = 'var x = 1;'
      const map = '{"mappings":"AAAA"}'
      const fromString = computeChunkId(js, map)
      const fromBuffer = computeChunkId(Buffer.from(js), Buffer.from(map))
      expect(fromString).toBe(fromBuffer)
    })

    it('matches Rust CLI implementation', () => {
      // This value is verified against the Rust chunk_id_hash function
      // in cli/src/utils/files/content.rs with the same inputs
      const result = computeChunkId('var x = 1;', '{"mappings":"AAAA"}')
      expect(result).toBe('c1b08c52e81d19e59bfcb02180762bea')
    })
  })

  describe('buildCodeSnippet', () => {
    it('replaces placeholder with chunk ID', () => {
      const result = buildCodeSnippet('abc123')
      expect(result).toContain('abc123')
      expect(result).not.toContain(CHUNKID_PLACEHOLDER)
      expect(result).toContain('_posthogChunkIds')
    })
  })

  describe('buildChunkComment', () => {
    it('replaces placeholder with chunk ID', () => {
      const result = buildChunkComment('abc123')
      expect(result).toBe('\n//# chunkId=abc123')
    })
  })

  describe('constants match CLI', () => {
    it('snippet template matches Rust constant', () => {
      expect(CODE_SNIPPET_TEMPLATE).toBe(
        '!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]="__POSTHOG_CHUNK_ID__")}catch(e){}}();'
      )
    })

    it('comment prefix matches Rust constant', () => {
      expect(CHUNKID_COMMENT_PREFIX).toBe('\n//# chunkId=__POSTHOG_CHUNK_ID__')
    })
  })
})
