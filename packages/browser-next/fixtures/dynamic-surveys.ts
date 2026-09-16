import { createPostHog } from '@posthog/browser/core'
void import('@posthog/browser/surveys').then(async ({ surveys }) => {
    const posthog = await createPostHog({ projectToken: 'ph_test', extensions: [surveys()] })
    posthog.displaySurvey('test')
})
