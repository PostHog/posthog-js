import { PostHog } from 'posthog-node'
import { uuidv7 } from '@posthog/core/vendor/uuidv7'
import { defineNitroPlugin } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'

export default defineNitroPlugin((nitroApp) => {
  const runtimeConfig = useRuntimeConfig()
  const exceptionAutoCaptureEnabled = (runtimeConfig.public.nitroExceptionAutoCaptureEnabled as boolean) || false
  if (!exceptionAutoCaptureEnabled) {
    return
  }

  const host = runtimeConfig.public.posthogHost as string
  const apiKey = runtimeConfig.public.posthogPublicKey as string
  const configOverride = runtimeConfig.public.nitroPosthogClientConfigOverride as Record<string, unknown>
  const debug = runtimeConfig.public.nitroPosthogClientDebug as boolean

  const client = new PostHog(apiKey, {
    host: host,
    ...configOverride,
  })

  if (debug) {
    client.debug(true)
  }

  nitroApp.hooks.hook('error', async (error, { event }) => {
    await client.captureException(error, uuidv7(), {
      $process_person_profile: false,
      path: event?.path,
      method: event?.method,
    })
  })
})
