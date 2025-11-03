import { PostHog } from 'posthog-node'
import { uuidv7 } from '@posthog/core/vendor/uuidv7'
import { defineNitroPlugin } from 'nitropack/runtime'
import { useRuntimeConfig } from '#imports'
import type { PostHogCommon, PostHogServerConfig } from '../module'

export default defineNitroPlugin((nitroApp) => {
  const runtimeConfig = useRuntimeConfig()
  const posthogCommon = runtimeConfig.public.posthog as PostHogCommon
  const posthogServerConfig = runtimeConfig.posthogServerConfig as PostHogServerConfig
  const debug = posthogCommon.debug as boolean

  const client = new PostHog(posthogCommon.publicKey, {
    host: posthogCommon.host,
    ...posthogServerConfig,
  })

  if (debug) {
    client.debug(true)
  }

  if (posthogServerConfig.enableExceptionAutocapture) {
    nitroApp.hooks.hook('error', (error, { event }) => {
      client.captureException(error, uuidv7(), {
        $process_person_profile: false,
        path: event?.path,
        method: event?.method,
      })
    })
  }

  nitroApp.hooks.hook('close', async () => {
    await client.shutdown()
  })
})
