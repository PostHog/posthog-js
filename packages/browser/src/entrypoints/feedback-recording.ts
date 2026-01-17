import { generateFeedbackRecording } from '../extensions/feedback-recording'

import { assignableWindow } from '../utils/globals'

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.generateFeedbackRecording = generateFeedbackRecording

export default generateFeedbackRecording
