import { PostHog, type PostHogOptions } from 'posthog-node'
import { uuidv7 } from '@posthog/core/vendor/uuidv7'
import { defineNitroPlugin } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'

export default defineNitroPlugin((nitroApp) => {
  const runtimeConfig = useRuntimeConfig()

  const host = runtimeConfig.public.posthogHost as string
  const apiKey = runtimeConfig.public.posthogPublicKey as string
  const configOverride = runtimeConfig.public.posthogServerConfig as PostHogOptions
  const debug = runtimeConfig.public.posthogDebug as boolean

  const { enableExceptionAutocapture, ...restOfConfig } = configOverride

  const client = new PostHog(apiKey, {
    host: host,
    ...restOfConfig,
  })

  if (debug) {
    client.debug(true)
  }

  if (configOverride.enableExceptionAutocapture) {
    nitroApp.hooks.hook('error', async (error, { event }) => {
      await client.captureException(error, uuidv7(), {
        $process_person_profile: false,
        path: event?.path,
        method: event?.method,
      })
    })
  }
})
