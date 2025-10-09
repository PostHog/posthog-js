import { defineNuxtPlugin, useRuntimeConfig } from '#app'

import posthog from 'posthog-js'

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig()
  const publicApiKey = runtimeConfig.public.posthogPublicKey as string
  const host = runtimeConfig.public.posthogHost as string
  const exceptionAutoCaptureEnabled = (runtimeConfig.public.nuxtExceptionAutoCaptureEnabled as boolean) || false
  const configOverride = runtimeConfig.public.nuxtPosthogClientConfigOverride as Record<string, unknown>
  const debug = runtimeConfig.public.nuxtPosthogClientDebug as boolean

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

  if (exceptionAutoCaptureEnabled) {
    nuxtApp.hooks.hook('vue:error', (error) => {
      posthog.captureException(error)
    })
  }

  return {
    provide: {
      posthog: () => posthog,
    },
  }
})
