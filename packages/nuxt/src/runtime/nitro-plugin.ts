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
      const props: Record<string, any> = {
        $process_person_profile: false,
      }
      if (event?.path) {
        props.path = event.path
      }
      if (event?.method) {
        props.method = event.method
      }

      client.captureException(error, uuidv7(), props)
    })
  }

  nitroApp.hooks.hook('close', async () => {
    await client.shutdown()
  })
})
