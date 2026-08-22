import type { MixedOutput, Module } from 'metro'
import { createPostHogMetroSerializer } from '../src/tooling/posthogMetroSerializer'
import {
  createDebugIdSnippet,
  determineDebugIdFromBundleSource,
  type MetroSerializer,
} from '../src/tooling/utils'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('PostHog Metro serializer', () => {
  test('generates a real deterministic chunk id for a bare React Native bundle', async () => {
    const serializer = createPostHogMetroSerializer()

    const first = await serializer(...mockSerializerArgs())
    const second = await serializer(...mockSerializerArgs())

    expect(typeof first).not.toBe('string')
    expect(typeof second).not.toBe('string')
    if (typeof first === 'string' || typeof second === 'string') {
      throw new Error('Expected serialized bundle output')
    }

    const firstChunkId = determineDebugIdFromBundleSource(first.code)
    const secondChunkId = determineDebugIdFromBundleSource(second.code)

    expect(firstChunkId).toMatch(UUID_PATTERN)
    expect(secondChunkId).toBe(firstChunkId)
    expect(first.code).not.toContain('__POSTHOG_CHUNK_ID__')
    expect(first.code).toContain(`//# chunkId=${firstChunkId}`)

    const map = JSON.parse(first.map) as { chunkId?: string; sourcesContent?: string[] }
    expect(map.chunkId).toBe(firstChunkId)
    expect(map.sourcesContent?.join('\n')).toContain(firstChunkId)
    expect(map.sourcesContent?.join('\n')).not.toContain('__POSTHOG_CHUNK_ID__')
  })

  test('extracts the generated id when the runtime map uses a variable stack key', () => {
    const chunkId = '12345678-1234-4abc-8def-123456789abc'
    const snippet = createDebugIdSnippet(chunkId)

    expect(snippet).toContain('_posthogChunkIds[n]')
    expect(determineDebugIdFromBundleSource(snippet)).toBe(chunkId)
    expect(determineDebugIdFromBundleSource(createDebugIdSnippet('__POSTHOG_CHUNK_ID__'))).toBeUndefined()
  })
})

function mockSerializerArgs(): Parameters<MetroSerializer> {
  let modulesCounter = 0
  const options: Record<string, unknown> = {
    asyncRequireModulePath: 'asyncRequire',
    createModuleId: (_filePath: string): number => modulesCounter++,
    dev: false,
    getRunModuleStatement: (_moduleId: string | number): string => '',
    includeAsyncPaths: false,
    modulesOnly: false,
    processModuleFilter: (_module: Module<MixedOutput>) => true,
    projectRoot: '/project/root',
    runBeforeMainModule: [],
    runModule: false,
    serverRoot: '/server/root',
    shouldAddToIgnoreList: (_module: Module<MixedOutput>) => false,
  }

  return [
    'index.js',
    [],
    {
      entryPoints: new Set(),
      dependencies: new Map(),
      transformOptions: {
        hot: false,
        dev: false,
        minify: false,
        type: 'script',
        unstable_transformProfile: 'hermes-stable',
      },
    },
    options as Parameters<MetroSerializer>[3],
  ]
}
