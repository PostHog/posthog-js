import { createPostHog } from '@posthog/browser/core'
import { sessionRecording } from '@posthog/browser/session-recording'
const replay = sessionRecording()
void createPostHog({ projectToken: 'ph_test', extensions: [replay] }).then(() => replay.startSessionRecording())
