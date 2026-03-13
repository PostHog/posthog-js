import { createHash } from 'node:crypto'

export const CODE_SNIPPET_TEMPLATE =
  '!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._posthogChunkIds=e._posthogChunkIds||{},e._posthogChunkIds[n]="__POSTHOG_CHUNK_ID__")}catch(e){}}();'

export const CHUNKID_COMMENT_PREFIX = '\n//# chunkId=__POSTHOG_CHUNK_ID__'

export const CHUNKID_PLACEHOLDER = '__POSTHOG_CHUNK_ID__'

/**
 * Computes a deterministic chunk ID from pre-injection JS and source map content.
 * Uses SHA-256(jsContent || sourcemapContent) truncated to 32 hex chars.
 * Must match the Rust CLI implementation in cli/src/utils/files/content.rs.
 */
export function computeChunkId(jsContent: string | Buffer, sourcemapContent: string | Buffer): string {
  const hash = createHash('sha256')
  hash.update(jsContent)
  hash.update(sourcemapContent)
  return hash.digest('hex').slice(0, 32)
}

/**
 * Returns the JS snippet with the chunk ID placeholder replaced.
 */
export function buildCodeSnippet(chunkId: string): string {
  return CODE_SNIPPET_TEMPLATE.replace(CHUNKID_PLACEHOLDER, chunkId)
}

/**
 * Returns the chunk ID comment with the placeholder replaced.
 */
export function buildChunkComment(chunkId: string): string {
  return CHUNKID_COMMENT_PREFIX.replace(CHUNKID_PLACEHOLDER, chunkId)
}
