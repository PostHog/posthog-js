import { PostHog } from '../posthog-core'
import { renderFeedbackRecordingUI } from './feedback-recording/components/FeedbackRecordingUI'
import { removeFeedbackRecordingUIFromDOM } from './feedback-recording/feedback-recording-utils'
import { AudioRecorder } from './feedback-recording/audio-recorder'
import type { AudioRecordingResult } from './feedback-recording/audio-recorder'

export interface FeedbackRecordingExtension {
    renderFeedbackRecordingUI(config: {
        posthogInstance: PostHog
        handleStartRecording: () => Promise<string>
        onRecordingEnded: (feedbackId: string) => Promise<void>
        onCancel?: () => void
    }): void
    removeUI(): void
    startAudioRecording(): Promise<void>
    stopAudioRecording(): Promise<AudioRecordingResult | null>
    cancelAudioRecording(): Promise<void>
    isAudioRecording(): boolean
}

// Extension generator function for the extension system
export function generateFeedbackRecording(): FeedbackRecordingExtension {
    const audioRecorder = new AudioRecorder()

    return {
        renderFeedbackRecordingUI(config) {
            renderFeedbackRecordingUI(config)
        },
        removeUI() {
            removeFeedbackRecordingUIFromDOM()
        },
        async startAudioRecording() {
            await audioRecorder.startRecording()
        },
        async stopAudioRecording() {
            return audioRecorder.stopRecording()
        },
        async cancelAudioRecording() {
            await audioRecorder.cancelRecording()
        },
        isAudioRecording() {
            return audioRecorder.isRecording()
        },
    }
}
