import { isNull } from '@posthog/core'
import { PostHog } from '../posthog-core'
import { renderFeedbackRecordingUI } from './feedback-recording/components/FeedbackRecordingUI'
import { removeFeedbackRecordingUIFromDOM } from './feedback-recording/feedback-recording-utils'
import { AudioRecorder } from './feedback-recording/audio-recorder'
import { createLogger } from '../utils/logger'
import { uuidv7 } from '../uuidv7'
import { RequestResponse, UserFeedbackRecordingResult } from '../types'

const logger = createLogger('[PostHog FeedbackManager]')

const MAX_AUDIO_SIZE = 10 * 1024 * 1024 // 10MB limit to match backend

export class FeedbackRecordingManager {
    private _posthog: PostHog
    private _audioRecorder: AudioRecorder
    private _feedbackRecordingId: string | null = null
    private _didStartSessionRecording: boolean = false

    constructor(posthog: PostHog) {
        this._posthog = posthog
        this._audioRecorder = new AudioRecorder()
    }

    launchFeedbackRecordingUI(
        onRecordingEnded: (result: UserFeedbackRecordingResult) => void,
        onCancel: () => void
    ): void {
        renderFeedbackRecordingUI({
            posthogInstance: this._posthog,
            handleStartRecording: () => this._startRecording(),
            onRecordingEnded: async (feedbackId: string) => {
                await this._stopRecording(feedbackId, onRecordingEnded)
            },
            onCancel: () => {
                this._resetState()
                logger.info('Feedback recording UI cancelled')
                onCancel()
            },
        })
    }

    cleanup(): void {
        if (this._audioRecorder.isRecording()) {
            this._audioRecorder.cancelRecording()
        }

        if (this._didStartSessionRecording) {
            this._posthog.stopSessionRecording()
            logger.info('Stopped session recording during cleanup')
        }

        removeFeedbackRecordingUIFromDOM()
        this._resetState()
    }

    getCurrentFeedbackRecordingId(): string | null {
        return this._feedbackRecordingId
    }

    isFeedbackRecordingActive(): boolean {
        return !isNull(this._feedbackRecordingId)
    }

    private async _startRecording(): Promise<string> {
        const feedbackId = uuidv7()
        this._feedbackRecordingId = feedbackId

        this._posthog.capture('$user_feedback_recording_started', {
            $feedback_recording_id: feedbackId,
        })

        try {
            await this._audioRecorder.startRecording()
        } catch (error) {
            logger.warn('Failed to start audio recording:', error)
        }

        const wasSessionRecordingActive = this._posthog.sessionRecordingStarted()
        if (!wasSessionRecordingActive) {
            this._posthog.startSessionRecording(true)
            this._didStartSessionRecording = true
            logger.info('Started session recording for feedback')
        } else {
            this._didStartSessionRecording = false
            logger.info('Session recording already active, reusing existing recording')
        }

        return feedbackId
    }

    private _handleStopped(feedbackRecordingId: string): UserFeedbackRecordingResult {
        this._posthog.capture('$user_feedback_recording_stopped', {
            $feedback_recording_id: feedbackRecordingId,
        })

        return { feedback_id: feedbackRecordingId, session_id: this._posthog.get_session_id() }
    }

    private _uploadAudioBlob(feedbackId: string, audioBlob: Blob): void {
        if (audioBlob.size > MAX_AUDIO_SIZE) {
            logger.error(`Audio blob too large: ${audioBlob.size} bytes (max: ${MAX_AUDIO_SIZE})`)
            return
        }

        const reader = new FileReader()
        reader.onload = () => {
            if (typeof reader.result !== 'string') {
                logger.error('FileReader result is not a string')
                return
            }
            const base64Data = reader.result.split(',')[1] // Remove data:audio/webm;base64, prefix

            const url = this._posthog.requestRouter.endpointFor('api', `/api/feedback/audio`)

            this._posthog._send_request({
                method: 'POST',
                url,
                data: {
                    token: this._posthog.config.token,
                    feedback_id: feedbackId,
                    audio_data: base64Data,
                    audio_mime_type: audioBlob.type,
                    audio_size: audioBlob.size,
                },
                callback: (response: RequestResponse) => {
                    if (response.statusCode === 200) {
                        logger.info(`Audio upload successful for feedback ${feedbackId}`)
                    } else {
                        logger.error(`Audio upload failed for feedback ${feedbackId}:`, response.text)
                    }
                },
            })
        }
        reader.onerror = () => {
            logger.error(`Failed to read audio blob for feedback ${feedbackId}:`, reader.error)
        }
        reader.readAsDataURL(audioBlob)
    }

    private async _stopRecording(
        feedbackId: string,
        onRecordingEnded: (result: UserFeedbackRecordingResult) => void
    ): Promise<void> {
        if (this._didStartSessionRecording) {
            this._posthog.stopSessionRecording()
            logger.info('Stopped session recording after feedback recording ended')
        }

        const recordingResult = await this._audioRecorder.stopRecording()

        if (recordingResult?.blob) {
            logger.info(`Audio recording completed, blob size: ${recordingResult.blob.size} bytes`)
            this._uploadAudioBlob(feedbackId, recordingResult.blob)
        }

        removeFeedbackRecordingUIFromDOM()
        onRecordingEnded(this._handleStopped(feedbackId))

        this._resetState()
    }

    private _resetState(): void {
        this._feedbackRecordingId = null
        this._didStartSessionRecording = false
    }
}

// Extension generator function for the extension system
export function generateFeedbackRecording(instance: PostHog): FeedbackRecordingManager {
    return new FeedbackRecordingManager(instance)
}
