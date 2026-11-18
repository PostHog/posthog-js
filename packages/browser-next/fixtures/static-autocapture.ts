import { createPostHog } from '@posthog/browser/core'
import { autocapture } from '@posthog/browser/autocapture'
import { analytics } from '@posthog/browser/analytics'
void createPostHog({ projectToken: 'ph_test', extensions: [analytics(), autocapture()] }).then((posthog) =>
    posthog.analytics?.capture('test')
)
