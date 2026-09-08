import type { MixedOutput, Module } from 'metro'
import {
  createPostHogMetroSerializer,
  unstableBeforeAssetSerializationDebugIdPlugin,
} from '../src/tooling/posthogMetroSerializer'
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

  describe('Expo static exports', () => {
    test.each([
      { name: 'explicit options', options: { serializerOptions: { output: 'static' } } },
      {
        name: 'explicit static options overriding a plain URL',
        options: {
          serializerOptions: { output: 'static' },
          sourceUrl: 'https://expo.dev/index.bundle?serializer.output=default',
        },
      },
      { name: 'source URL', options: { sourceUrl: 'https://expo.dev/index.bundle?serializer.output=static' } },
      { name: 'relative URL', options: { sourceUrl: '/index.bundle?serializer.output=static' } },
      { name: 'JSC-safe URL', options: { sourceUrl: 'https://expo.dev/index.bundle//&serializer.output=static' } },
    ])('delegates before injection with $name', async ({ options }) => {
      const input = mockSerializerArgs(options, { transformOptions: { platform: 'ios' } })
      const chunkId = '12345678-1234-4abc-8def-123456789abc'
      const inner = vi.fn((...[_entryPoint, premodules, graph]: Parameters<MetroSerializer>) => {
        const modules = unstableBeforeAssetSerializationDebugIdPlugin({
          graph,
          premodules: [...premodules],
          debugId: chunkId,
        })
        const code = modules.map((module) => module.getSource().toString()).join('\n')
        return {
          artifacts: [
            { type: 'js', filename: 'index.js', source: code },
            { type: 'map', filename: 'index.js.map', source: JSON.stringify({ debugId: chunkId }) },
          ],
          assets: [],
        }
      })
      // Expo's static export result is outside Metro's plain-bundle return type.
      const result = await createPostHogMetroSerializer(inner as unknown as MetroSerializer)(...input)
      const exported = inner.mock.results[0].value

      expect(result).toBe(exported)
      expect(inner).toHaveBeenCalledTimes(1)
      expect(inner.mock.calls[0][1]).toBe(input[1])
      expect(inner).toHaveBeenCalledWith(...input)
      expect(input[3]).not.toHaveProperty('posthogBundleCallback')
      expect(determineDebugIdFromBundleSource(exported.artifacts[0].source)).toBe(chunkId)
      expect(JSON.parse(exported.artifacts[1].source).debugId).toBe(chunkId)
      expect(JSON.stringify(exported)).not.toContain('__POSTHOG_CHUNK_ID__')
    })

    test.each(['array', 'promised array', 'JSON', 'binary artifact'])('preserves %s output', async (shape) => {
      const assets = [{ filename: 'index.js', source: 'console.log("app");' }]
      const output =
        shape === 'JSON'
          ? JSON.stringify({ artifacts: assets, assets: [] })
          : shape === 'binary artifact'
            ? { artifacts: [{ filename: 'index.hbc', source: Buffer.from([0, 255, 1]) }], assets: [] }
            : assets
      const inner = vi.fn(() => (shape === 'promised array' ? Promise.resolve(output) : output))
      const input = mockSerializerArgs({ serializerOptions: { output: 'static' } })
      const result = await createPostHogMetroSerializer(inner as unknown as MetroSerializer)(...input)

      expect(result).toBe(output)
      expect(inner).toHaveBeenCalledTimes(1)
      expect(inner).toHaveBeenCalledWith(...input)
      expect(input[3]).not.toHaveProperty('posthogBundleCallback')
    })

    test.each([
      { serializerOptions: { output: 'default' }, sourceUrl: 'https://expo.dev/index.bundle?serializer.output=static' },
      { serializerOptions: {}, sourceUrl: 'https://expo.dev/index.bundle?serializer.output=static' },
      { sourceUrl: 'https://expo.dev/index.bundle?serializer.output=default' },
      { sourceUrl: 'https://expo.dev/index.bundle?other=serializer.output%3Dstatic' },
      { sourceUrl: 'https://expo.dev/index.bundle#serializer.output=static' },
      { sourceUrl: 'https://expo.dev/index.bundle//&serializer.output=static?serializer.output=default' },
      { sourceUrl: 'http://[' },
    ])('keeps the plain-bundle path for %j', async (options) => {
      const inner = vi.fn<MetroSerializer>(() => ({ code: 'console.log("app");', map: '{}' }))
      await expect(createPostHogMetroSerializer(inner)(...mockSerializerArgs(options))).rejects.toThrow(
        'Chunk ID was not found in the bundle.'
      )
      expect(inner).toHaveBeenCalledTimes(1)
    })

    test('does not skip the default Metro serializer based on Expo options alone', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      try {
        const result = await createPostHogMetroSerializer()(
          ...mockSerializerArgs({ serializerOptions: { output: 'static' } })
        )
        expect(typeof result).not.toBe('string')
        if (typeof result !== 'string') {
          expect(determineDebugIdFromBundleSource(result.code)).toMatch(UUID_PATTERN)
        }
      } finally {
        log.mockRestore()
      }
    })
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
