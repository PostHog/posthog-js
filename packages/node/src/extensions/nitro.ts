import { PostHogBackendClient } from '../client'
import { PostHog } from '../entrypoints/index.node'
import ErrorTracking from './error-tracking'
import { uuidv7 } from '@posthog/core/vendor/uuidv7'

export type PostHogPluginConfig =
  | {
      client: PostHogBackendClient
    }
  | {
      apiKey: string
      host?: string
    }

export interface NitroApp {
  hooks: {
    hook: {
      <TName extends string>(name: TName, callback: (...args: any[]) => any, options?: any): void
      (event: string, callback: (error: Error, context: { event: { path: string; method: string } }) => void): void
    }
  }
}

export function PostHogPlugin(config: PostHogPluginConfig) {
  console.log('Initializing posthog plugin...')
  const clientWasProvided = 'client' in config

  const client = clientWasProvided
    ? config.client
    : new PostHog(config.apiKey, {
        host: config.host || 'https://us.i.posthog.com',
      })

  client.debug(true)

  return (nitroApp: NitroApp): void => {
    nitroApp.hooks.hook('error', async (error, { event }) => {
      const hint = { mechanism: { type: 'nitro', handled: false } }

      // Given stateless nature of Node SDK we capture exceptions using personless processing
      // when no user can be determined e.g. in the case of exception autocapture
      const message = await ErrorTracking.buildEventMessage(error, hint, uuidv7(), {
        $process_person_profile: false,
        path: event?.path,
        method: event?.method,
      })

      client.capture(message)
    })
  }
}
