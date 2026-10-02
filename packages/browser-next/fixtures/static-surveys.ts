import { createPostHog } from '@posthog/browser/core'
import { surveys } from '@posthog/browser/surveys'
const extension = surveys()
void createPostHog({ projectToken: 'ph_test', extensions: [extension] }).then(() => extension.displaySurvey('test'))
