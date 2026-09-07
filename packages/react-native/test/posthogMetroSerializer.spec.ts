import type { MixedOutput, Module } from 'metro'
import { createPostHogMetroSerializer } from '../src/tooling/posthogMetroSerializer'
import {
  createDebugIdSnippet,
  createVirtualJSModule,
  determineDebugIdFromBundleSource,
  type MetroSerializer,
} from '../src/tooling/utils'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('PostHog Metro serializer', () => {
  test('generates a real deterministic chunk id for a bare React Native bundle', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const serializer = createPostHogMetroSerializer()

    const first = await serializer(...mockSerializerArgs())
    const second = await serializer(...mockSerializerArgs())

    expect(consoleLogSpy).toHaveBeenCalledTimes(2)
    consoleLogSpy.mockRestore()

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

  test('keeps an async chunk serialized when modulesOnly drops premodules', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const serializer = createPostHogMetroSerializer()
    const premodule = createVirtualJSModule('__prelude__', 'globalThis.__premodule_loaded__ = true;')
    const applicationModule = createVirtualJSModule(
      '/project/root/lazy.js',
      'globalThis.__application_module_loaded__ = true;'
    )

    const result = await serializer(
      ...mockSerializerArgs(
        { modulesOnly: true },
        {
          premodules: [premodule],
          dependencies: new Map([[applicationModule.path, applicationModule]]),
        }
      )
    )

    expect(typeof result).not.toBe('string')
    if (typeof result === 'string') {
      throw new Error('Expected serialized bundle output')
    }

    expect(result.code).toContain('__application_module_loaded__')
    expect(result.code).not.toContain('__premodule_loaded__')
    expect(result.code).not.toContain('__POSTHOG_CHUNK_ID__')
    expect(result.code).not.toContain('//# chunkId=')
    expect(consoleWarnSpy).not.toHaveBeenCalled()
    consoleWarnSpy.mockRestore()
  })

  test('does not invoke a custom serializer twice when the chunk id is missing', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const innerSerializer = vi.fn<MetroSerializer>((_entryPoint, premodules) => {
      if (innerSerializer.mock.calls.length > 1) {
        throw new Error('Custom serializer was called twice')
      }
      return {
        code: premodules.map((module) => module.getSource().toString()).join('\n'),
        map: '{}',
      }
    })
    const serializer = createPostHogMetroSerializer(innerSerializer)

    await expect(serializer(...mockSerializerArgs())).rejects.toThrow('Chunk ID was not found in the bundle.')
    expect(innerSerializer).toHaveBeenCalledTimes(1)
    expect(consoleWarnSpy).not.toHaveBeenCalled()
    consoleWarnSpy.mockRestore()
  })

  test('skips chunk id work for a hot-less Metro dev-server request', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const args = mockSerializerArgs(
      { sourceUrl: 'http://localhost:8081/index.bundle?dev=true' },
      { transformOptions: { dev: true } }
    )
    delete (args[2].transformOptions as { hot?: boolean }).hot

    const result = await createPostHogMetroSerializer()(...args)

    expect(typeof result).toBe('string')
    expect(result).not.toContain('__POSTHOG_CHUNK_ID__')
    expect(result).not.toContain('//# chunkId=')
    expect(consoleLogSpy).not.toHaveBeenCalled()
    consoleLogSpy.mockRestore()
  })

  test.each([
    { name: 'development CLI bundle', dev: true, sourceUrl: undefined },
    { name: 'Expo release bundle', dev: false, sourceUrl: 'https://expo.dev/index.bundle' },
  ])('keeps chunk ids for a hot-less $name', async ({ dev, sourceUrl }) => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const args = mockSerializerArgs({ sourceUrl }, { transformOptions: { dev } })
    delete (args[2].transformOptions as { hot?: boolean }).hot

    const result = await createPostHogMetroSerializer()(...args)

    expect(typeof result).not.toBe('string')
    if (typeof result === 'string') {
      throw new Error('Expected serialized bundle output')
    }
    expect(determineDebugIdFromBundleSource(result.code)).toMatch(UUID_PATTERN)
    expect(consoleLogSpy).toHaveBeenCalledTimes(1)
    consoleLogSpy.mockRestore()
  })

  test('extracts the generated id when the runtime map uses a variable stack key', () => {
    const chunkId = '12345678-1234-4abc-8def-123456789abc'
    const snippet = createDebugIdSnippet(chunkId)

    expect(snippet).toContain('_posthogChunkIds[n]')
    expect(determineDebugIdFromBundleSource(snippet)).toBe(chunkId)
    expect(determineDebugIdFromBundleSource(createDebugIdSnippet('__POSTHOG_CHUNK_ID__'))).toBeUndefined()
  })
})

function mockSerializerArgs(
  optionsOverrides: Record<string, unknown> = {},
  {
    premodules = [],
    dependencies = new Map(),
    transformOptions: transformOptionsOverrides = {},
  }: {
    premodules?: Module<MixedOutput>[]
    dependencies?: Map<string, Module<MixedOutput>>
    transformOptions?: Record<string, unknown>
  } = {}
): Parameters<MetroSerializer> {
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
    ...optionsOverrides,
  }

  return [
    'index.js',
    premodules,
    {
      entryPoints: new Set(),
      dependencies,
      transformOptions: {
        hot: false,
        dev: false,
        minify: false,
        type: 'script',
        unstable_transformProfile: 'hermes-stable',
        ...transformOptionsOverrides,
      },
    },
    options as Parameters<MetroSerializer>[3],
  ]
}
