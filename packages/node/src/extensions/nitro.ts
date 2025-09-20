import { PostHogBackendClient } from '../client'
import ErrorTracking from './error-tracking'
import { uuidv7 } from '@posthog/core/vendor/uuidv7'

interface CapturedErrorContext {
  event?: { path: string; method: string }
  tags?: string[]
}

export function setupNitroErrorHandler(
  _posthog: PostHogBackendClient,
  nitroApp: {
    hooks: {
      hook: (event: string, callback: (error: Error, errorContext: CapturedErrorContext) => Promise<void>) => void
    }
  }
): void {
  nitroApp.hooks.hook('error', async (error: Error, { event }: CapturedErrorContext): Promise<void> => {
    const hint = { mechanism: { type: 'nitro', handled: false } }

    // Given stateless nature of Node SDK we capture exceptions using personless processing
    // when no user can be determined e.g. in the case of exception autocapture
    ErrorTracking.buildEventMessage(error, hint, uuidv7(), {
      $process_person_profile: false,
      path: event?.path,
      method: event?.method,
    }).then((msg) => _posthog.capture(msg))
  })
}
