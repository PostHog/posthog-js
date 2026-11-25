import { createPostHog } from '@posthog/browser/core'
import { webVitals } from '@posthog/browser/web-vitals'

void createPostHog({ projectToken: 'ph_test', extensions: [webVitals({ enabled: true })] })
