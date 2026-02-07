import { defineNuxtPlugin, useRuntimeConfig } from '#app'

import posthog from 'posthog-js'
import type { PostHogClientConfig, PostHogCommon } from '../module'

export default defineNuxtPlugin({
  name: 'posthog-client',
  setup(nuxtApp) {
    const runtimeConfig = useRuntimeConfig()
    const posthogCommon = runtimeConfig.public.posthog as PostHogCommon
    const posthogClientConfig = runtimeConfig.public.posthogClientConfig as PostHogClientConfig

    // Return undefined if PostHog is explicitly disabled
    if (posthogCommon.enabled === false) {
      return {
        provide: {
          posthog: () => undefined as typeof posthog | undefined,
        },
      }
    }

    // prevent nitro from trying to load this
    if (!window || posthog.__loaded) {
      return
    }

    posthog.init(posthogCommon.publicKey, {
      api_host: posthogCommon.host,
      ...posthogClientConfig,
    })

    if (posthogCommon.debug) {
      posthog.debug(true)
    }

    if (autocaptureEnabled(posthogClientConfig)) {
      nuxtApp.hook('vue:error', (error, info) => {
        posthog.captureException(error, { info })
      })
    }

    return {
      provide: {
        posthog: () => posthog as typeof posthog | undefined,
      },
    }
  },
})

function autocaptureEnabled(config: PostHogClientConfig): boolean {
  if (!config) return false
  if (typeof config.capture_exceptions === 'boolean') return config.capture_exceptions
  if (typeof config.capture_exceptions === 'object') return config.capture_exceptions.capture_unhandled_errors === true
  return false
}
