import { PostHog } from 'posthog-node'
import { uuidv7 } from '@posthog/core/vendor/uuidv7'
import type { PostHogCommon, PostHogServerConfig } from '../module'
import type { JsonType } from '@posthog/core'

type RequestContext = { path?: string, method?: string }
type ErrorHandler = (error: unknown, request?: RequestContext) => void
type NitroBindings = {
  useRuntimeConfig: () => unknown
  onError: (handler: ErrorHandler) => void
  onClose: (handler: () => Promise<void>) => void
}
type RuntimeConfig = {
  public: { posthog: PostHogCommon }
  posthogServerConfig: PostHogServerConfig
}

export function setupPostHogNitroPlugin({ useRuntimeConfig, onError, onClose }: NitroBindings): void {
  const runtimeConfig = useRuntimeConfig() as RuntimeConfig
  const posthogCommon = runtimeConfig.public.posthog
  const posthogServerConfig = runtimeConfig.posthogServerConfig
  const debug = posthogCommon.debug === true

  const client = new PostHog(posthogCommon.publicKey, {
    host: posthogCommon.host,
    ...posthogServerConfig,
  })

  if (debug) {
    client.debug(true)
  }

  if (posthogServerConfig.enableExceptionAutocapture) {
    onError((error, request) => {
      const props: JsonType = {
        $process_person_profile: false,
      }
      if (request?.path) {
        props.path = request.path
      }
      if (request?.method) {
        props.method = request.method
      }

      client.captureException(error, uuidv7(), props)
    })
  }

  onClose(async () => {
    await client.shutdown()
  })
}
