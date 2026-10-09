import type { StackParser } from './types'

const stackParser: StackParser = (stack) => [
  {
    platform: 'web:javascript',
    filename: stack.split('|')[0],
  },
]

describe('getFilenameToChunkIdMap', () => {
  beforeEach(() => {
    vi.resetModules()
    delete (globalThis as any)._posthogChunkIds
    delete (globalThis as any)._debugIds
  })

  afterEach(() => {
    delete (globalThis as any)._posthogChunkIds
    delete (globalThis as any)._debugIds
  })

  it('maps native debug IDs to filenames', async () => {
    ;(globalThis as any)._debugIds = {
      'https://example.com/chunk.js|native': 'native-debug-id',
    }
    const { getFilenameToChunkIdMap } = await import('./chunk-ids')

    expect(getFilenameToChunkIdMap(stackParser)).toEqual({
      'https://example.com/chunk.js': 'native-debug-id',
    })
  })

  it('prefers PostHog chunk IDs over native debug IDs for the same file', async () => {
    ;(globalThis as any)._debugIds = {
      'https://example.com/chunk.js|native': 'native-debug-id',
    }
    ;(globalThis as any)._posthogChunkIds = {
      'https://example.com/chunk.js|posthog': 'posthog-chunk-id',
    }
    const { getFilenameToChunkIdMap } = await import('./chunk-ids')

    expect(getFilenameToChunkIdMap(stackParser)).toEqual({
      'https://example.com/chunk.js': 'posthog-chunk-id',
    })
  })

  it('refreshes the cached map when native debug IDs are added', async () => {
    ;(globalThis as any)._debugIds = {
      'https://example.com/one.js|native': 'one',
    }
    const { getFilenameToChunkIdMap } = await import('./chunk-ids')

    expect(getFilenameToChunkIdMap(stackParser)).toEqual({ 'https://example.com/one.js': 'one' })

    ;(globalThis as any)._debugIds['https://example.com/two.js|native'] = 'two'

    expect(getFilenameToChunkIdMap(stackParser)).toEqual({
      'https://example.com/one.js': 'one',
      'https://example.com/two.js': 'two',
    })
  })

  it('refreshes the cached map when a debug ID map is replaced with the same number of entries', async () => {
    ;(globalThis as any)._debugIds = {
      'https://example.com/one.js|native': 'one',
    }
    const { getFilenameToChunkIdMap } = await import('./chunk-ids')

    expect(getFilenameToChunkIdMap(stackParser)).toEqual({ 'https://example.com/one.js': 'one' })

    ;(globalThis as any)._debugIds = {
      'https://example.com/two.js|native': 'two',
    }

    expect(getFilenameToChunkIdMap(stackParser)).toEqual({ 'https://example.com/two.js': 'two' })
  })
})
