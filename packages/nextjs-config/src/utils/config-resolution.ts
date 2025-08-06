import type { NextConfig } from 'next'
import type { PostHogNextConfig, PostHogNextConfigComplete, UserProvidedConfig } from '../types'

export function resolveUserConfig(
  userNextConfig: UserProvidedConfig,
  phase: string,
  defaultConfig: NextConfig
): Promise<NextConfig> {
  if (typeof userNextConfig === 'function') {
    const maybePromise = userNextConfig(phase, { defaultConfig })
    if (maybePromise instanceof Promise) {
      return maybePromise
    } else {
      return Promise.resolve(maybePromise)
    }
  } else if (typeof userNextConfig === 'object') {
    return Promise.resolve(userNextConfig)
  } else {
    throw new Error('Invalid user config')
  }
}

export function resolvePostHogConfig(posthogProvidedConfig: PostHogNextConfig): PostHogNextConfigComplete {
  const { personalApiKey, envId, host, verbose, sourcemaps = {} } = posthogProvidedConfig

  // Validate required configuration
  if (!personalApiKey) {
    throw new Error('PostHog: Personal API key not provided. Please set personalApiKey in your PostHog config.')
  }
  if (!envId) {
    throw new Error('PostHog: Environment ID not provided. Please set envId in your PostHog config.')
  }

  return {
    personalApiKey,
    envId,
    host: host ?? 'https://us.posthog.com',
    verbose: verbose ?? true,
    sourcemaps: {
      enabled: sourcemaps.enabled ?? process.env.NODE_ENV === 'production',
      project: sourcemaps.project,
      version: sourcemaps.version,
      deleteAfterUpload: sourcemaps.deleteAfterUpload ?? true,
      failOnError: sourcemaps.failOnError ?? false,
    },
  }
}
