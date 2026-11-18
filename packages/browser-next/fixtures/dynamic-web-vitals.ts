import { createPostHog } from '@posthog/browser/core'

void import('@posthog/browser/web-vitals').then(({ webVitals }) =>
    createPostHog({ projectToken: 'ph_test', extensions: [webVitals({ enabled: true })] })
)
