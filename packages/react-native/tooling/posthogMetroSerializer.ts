// copied from https://github.com/getsentry/sentry-react-native/blob/73f2455090a375857fe115ed135e524c70324cdd/packages/core/src/js/tools/sentryMetroSerializer.ts

// eslint-disable-next-line import/no-extraneous-dependencies
import type { MixedOutput, Module, ReadOnlyGraph } from 'metro'
import type { MetroSerializer, MetroSerializerOutput, SerializedBundle, VirtualJSOutput } from './utils'
import { createDebugIdSnippet, createVirtualJSModule, determineDebugIdFromBundleSource, prependModule } from './utils'
import { createDefaultMetroSerializer } from './vendor/metro/utils'

type SourceMap = Record<string, unknown>

const DEBUG_ID_PLACE_HOLDER = '__POSTHOG_CHUNK_ID__'
const DEBUG_ID_MODULE_PATH = '__chunkid__'

const SOURCE_MAP_COMMENT = '//# sourceMappingURL='
const DEBUG_ID_COMMENT = '//# chunkId='

/**
 * Adds PostHog Debug ID polyfill module to the bundle.
 */
export function unstableBeforeAssetSerializationDebugIdPlugin({
  premodules,
  debugId,
}: {
  graph: ReadOnlyGraph<MixedOutput>
  premodules: Module[]
  debugId?: string
}): Module[] {
  if (!debugId) {
    return premodules
  }

  const debugIdModuleExists = premodules.findIndex((module) => module.path === DEBUG_ID_MODULE_PATH) != -1
  if (debugIdModuleExists) {
    // eslint-disable-next-line no-console
    console.warn('\n\nDebug ID module found. Skipping PostHog Debug ID module...\n\n')
    return premodules
  }

  const debugIdModule = createDebugIdModule(debugId)
  return prependModule(premodules, debugIdModule)
}

/**
 * Creates a Metro serializer that adds Debug ID module to the plain bundle.
 * The Debug ID module is a virtual module that provides a debug ID in runtime.
 *
 * RAM Bundles do not support custom serializers.
 */
export const createPostHogMetroSerializer = (customSerializer?: MetroSerializer): MetroSerializer => {
  const serializer = customSerializer || createDefaultMetroSerializer()
  return async function (entryPoint, preModules, graph, options) {
    if (graph.transformOptions.hot) {
      return serializer(entryPoint, preModules, graph, options)
    }

    const debugIdModuleExists = preModules.findIndex((module) => module.path === DEBUG_ID_MODULE_PATH) != -1
    if (debugIdModuleExists) {
      // eslint-disable-next-line no-console
      console.warn('Debug ID module found. Skipping PostHog Debug ID module...')
      return serializer(entryPoint, preModules, graph, options)
    }

    const debugIdModule = createDebugIdModule(DEBUG_ID_PLACE_HOLDER)
    const modifiedPreModules = prependModule(preModules, debugIdModule)

    // Run wrapped serializer
    const serializerResult = serializer(entryPoint, modifiedPreModules, graph, options)
    const { code: bundleCode, map: bundleMapString } = await extractSerializerResult(serializerResult)

    // Add debug id comment to the bundle
    const debugId = determineDebugIdFromBundleSource(bundleCode)
    if (!debugId) {
      throw new Error('Debug ID was not found in the bundle.')
    }
    // Only print debug id for command line builds => not hot reload from dev server
    // eslint-disable-next-line no-console
    console.log('info ' + `Bundle Debug ID: ${debugId}`)

    const debugIdComment = `${DEBUG_ID_COMMENT}${debugId}`
    const indexOfSourceMapComment = bundleCode.lastIndexOf(SOURCE_MAP_COMMENT)
    const bundleCodeWithDebugId =
      indexOfSourceMapComment === -1
        ? // If source map comment is missing lets just add the debug id comment
          `${bundleCode}\n${debugIdComment}`
        : // If source map comment is present lets add the debug id comment before it
          `${bundleCode.substring(0, indexOfSourceMapComment) + debugIdComment}\n${bundleCode.substring(
            indexOfSourceMapComment
          )}`

    const bundleMap: SourceMap = JSON.parse(bundleMapString)

    bundleMap['chunkId'] = debugId

    return {
      code: bundleCodeWithDebugId,
      map: JSON.stringify(bundleMap),
    }
  }
}

async function extractSerializerResult(serializerResult: MetroSerializerOutput): Promise<SerializedBundle> {
  if (typeof serializerResult === 'string') {
    return { code: serializerResult, map: '{}' }
  }

  if ('map' in serializerResult) {
    return { code: serializerResult.code, map: serializerResult.map }
  }

  const awaitedResult = await serializerResult
  if (typeof awaitedResult === 'string') {
    return { code: awaitedResult, map: '{}' }
  }

  return { code: awaitedResult.code, map: awaitedResult.map }
}

function createDebugIdModule(debugId: string): Module<VirtualJSOutput> & { setSource: (code: string) => void } {
  return createVirtualJSModule(DEBUG_ID_MODULE_PATH, createDebugIdSnippet(debugId))
}
