// copied from https://github.com/getsentry/sentry-react-native/blob/73f2455090a375857fe115ed135e524c70324cdd/packages/core/src/js/tools/metroconfig.ts

import type { MetroConfig, MixedOutput, Module, ReadOnlyGraph } from 'metro'
import { createPostHogMetroSerializer, unstableBeforeAssetSerializationDebugIdPlugin } from './posthogMetroSerializer'
import type { DefaultConfigOptions } from './vendor/expo/expoconfig'

export * from './posthogMetroSerializer'

export interface PostHogMetroConfigOptions {}

export interface PostHogExpoConfigOptions {
  /**
   * Pass a custom `getDefaultConfig` function to override the default Expo configuration getter.
   */
  getDefaultConfig?: (projectRoot: string, options?: Record<string, unknown>) => Record<string, unknown>
}

/**
 * Adds PostHog to the Metro config.
 *
 * Adds Chunk ID to the output bundle and source maps.
 */
export function withPostHogConfig(config: MetroConfig, {}: PostHogMetroConfigOptions = {}): MetroConfig {
  let newConfig = config

  newConfig = withPostHogDebugId(newConfig)

  return newConfig
}

/**
 * This function returns Default Expo configuration with PostHog plugins.
 */
export function getPostHogExpoConfig(
  projectRoot: string,
  options: DefaultConfigOptions & PostHogExpoConfigOptions & PostHogMetroConfigOptions = {}
): MetroConfig {
  const getDefaultConfig = options.getDefaultConfig || loadExpoMetroConfigModule().getDefaultConfig
  const config = getDefaultConfig(projectRoot, {
    ...options,
    unstable_beforeAssetSerializationPlugins: [
      ...(options.unstable_beforeAssetSerializationPlugins || []),
      unstableBeforeAssetSerializationDebugIdPlugin,
    ],
  })

  return config
}

function loadExpoMetroConfigModule(): {
  getDefaultConfig: (
    projectRoot: string,
    options: {
      unstable_beforeAssetSerializationPlugins?: ((serializationInput: {
        graph: ReadOnlyGraph<MixedOutput>
        premodules: Module[]
        debugId?: string
      }) => Module[])[]
    }
  ) => MetroConfig
} {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo/metro-config')
  } catch (e) {
    throw new Error('Unable to load `expo/metro-config`. Make sure you have Expo installed.')
  }
}

type MetroCustomSerializer = Required<Required<MetroConfig>['serializer']>['customSerializer'] | undefined

function withPostHogDebugId(config: MetroConfig): MetroConfig {
  const customSerializer = createPostHogMetroSerializer(
    config.serializer?.customSerializer || undefined
  ) as MetroCustomSerializer
  // MetroConfig types customSerializers as async only, but sync returns are also supported
  // The default serializer is sync

  return {
    ...config,
    serializer: {
      ...config.serializer,
      customSerializer,
    },
  }
}
