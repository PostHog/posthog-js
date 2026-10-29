import { createPostHog } from '@posthog/browser/core'
import { autocapture } from '@posthog/browser/autocapture'
void createPostHog({ projectToken: 'ph_test', extensions: [autocapture()] }).then((posthog) => posthog.capture('test'))
