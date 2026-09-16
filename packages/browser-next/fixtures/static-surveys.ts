import { createPostHog } from '@posthog/browser/core'
import { surveys } from '@posthog/browser/surveys'
void createPostHog({ projectToken: 'ph_test', extensions: [surveys()] }).then((posthog) =>
    posthog.displaySurvey('test')
)
