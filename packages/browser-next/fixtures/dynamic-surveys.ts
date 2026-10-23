import { createPostHog } from '@posthog/browser/core'
void import('@posthog/browser/surveys').then(async ({ surveys }) => {
    const extension = surveys()
    await createPostHog({ projectToken: 'ph_test', extensions: [extension] })
    extension.displaySurvey('test')
})
