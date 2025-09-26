import { defineNuxtPlugin, useRuntimeConfig } from '#app'

import posthog from 'posthog-js'

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig()
  const publicApiKey = runtimeConfig.public.posthogPublicKey as string
  const host = runtimeConfig.public.posthogHost as string
  const exceptionAutoCaptureEnabled = (runtimeConfig.public.exceptionAutoCaptureEnabled as boolean) || false

  if (!window || posthog.__loaded) {
    return
  }

  posthog.init(publicApiKey, {
    api_host: host,
  })

  nuxtApp.hooks.hook('vue:error', async (error) => {
    if (!exceptionAutoCaptureEnabled) {
      return
    }
    posthog.captureException(error)
  })

  return {
    provide: {
      posthog: () => posthog,
    },
  }
})
