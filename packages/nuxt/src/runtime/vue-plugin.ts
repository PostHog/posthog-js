import { defineNuxtPlugin, useRuntimeConfig } from '#app'

import posthog, { type PostHogConfig } from 'posthog-js'

export default defineNuxtPlugin(() => {
  const runtimeConfig = useRuntimeConfig()
  const publicApiKey = runtimeConfig.public.posthogPublicKey as string
  const host = runtimeConfig.public.posthogHost as string
  const configOverride = runtimeConfig.public.posthogClientConfig as Partial<PostHogConfig>
  const debug = runtimeConfig.public.posthogDebug as boolean

  // prevent nitro from trying to load this
  if (!window || posthog.__loaded) {
    return
  }

  posthog.init(publicApiKey, {
    api_host: host,
    ...configOverride,
  })

  if (debug) {
    posthog.debug(true)
  }

  return {
    provide: {
      posthog: () => posthog,
    },
  }
})
