import { isNull } from '@posthog/core'
import { createLogger } from '../utils/logger'
import { uuidv7 } from '../uuidv7'
import { assignableWindow } from '../utils/globals'
import { RequestResponse, UserFeedbackRecordingResult } from '../types'
import { PostHog } from '../posthog-core'
import { renderFeedbackRecordingUI } from './feedback-recording/components/FeedbackRecordingUI'
import { removeFeedbackRecordingUIFromDOM } from './feedback-recording/feedback-recording-utils'
import { AudioRecorder } from './feedback-recording/audio-recorder'

const logger = createLogger('[PostHog FeedbackManager]')

const MAX_AUDIO_SIZE = 10 * 1024 * 1024 // 10MB limit to match backend

export class FeedbackRecordingManager {
    private _feedbackRecordingId: string | null = null
    private _isLoaded: boolean = false
    private _isLoading: boolean = false
    private _isUIActive: boolean = false

    constructor(
        private _instance: PostHog,
        private _audioRecorder: AudioRecorder = new AudioRecorder()
    ) {
        // Check if we're in the extension context (loaded from bundle)
        this._isLoaded = !!assignableWindow?.__PosthogExtensions__?.generateFeedbackRecording
    }

    getCurrentFeedbackRecordingId(): string | null {
        return this._feedbackRecordingId
    }

    isFeedbackRecordingActive(): boolean {
        return !isNull(this._feedbackRecordingId)
    }

    public cleanup(): void {
        if (this._audioRecorder.isRecording()) {
            this._audioRecorder.cancelRecording()
        }

        this._resetState()
        removeFeedbackRecordingUIFromDOM()

        logger.info('Feedback recording cleaned up')
    }

    async launchFeedbackRecordingUI(onRecordingEnded?: (result: UserFeedbackRecordingResult) => void): Promise<void> {
        if (this._isUIActive) {
            logger.warn('Feedback recording UI is already active. Request to launch a new UI will be ignored.')
            return
        }

        if (this._feedbackRecordingId) {
            logger.warn(
                `Feedback recording is already in progress with id ${this._feedbackRecordingId}. Request to start a new recording will be ignored.`
            )
            return
        }

        // Handle lazy loading if not loaded yet
        if (!this._isLoaded) {
            if (this._isLoading) {
                logger.info('Feedback recording is already loading...')
                return
            }

            await this._loadFeedbackRecording()

            if (!this._isLoaded) {
                logger.error('Failed to load feedback recording')
                return
            }
        }

        this._isUIActive = true
        this._showFeedbackRecordingUI(onRecordingEnded || (() => {}))
    }

    private async _loadFeedbackRecording(): Promise<void> {
        const phExtensions = assignableWindow?.__PosthogExtensions__
        if (!phExtensions) {
            logger.error('PostHog Extensions not found')
            return
        }

        if (phExtensions.generateFeedbackRecording) {
            // Already loaded
            this._isLoaded = true
            return
        }

        if (!phExtensions.loadExternalDependency) {
            logger.error('PostHog loadExternalDependency extension not found')
            return
        }

        this._isLoading = true

        // eslint-disable-next-line compat/compat
        return new Promise((resolve) => {
            phExtensions.loadExternalDependency!(this._instance, 'feedback-recording', (err) => {
                this._isLoading = false
                if (err || !phExtensions.generateFeedbackRecording) {
                    logger.error('Could not load feedback recording script', err)
                    this._isLoaded = false
                } else {
                    logger.info('Feedback recording loaded successfully')
                    this._isLoaded = true
                }
                resolve()
            })
        })
    }

    async _startFeedbackRecording(): Promise<string> {
        const feedbackId = uuidv7()
        this._feedbackRecordingId = feedbackId

        this._instance.capture('$user_feedback_recording_started', {
            $feedback_recording_id: feedbackId,
        })

        try {
            await this._audioRecorder.startRecording()
        } catch (error) {
            logger.warn('Failed to start audio recording:', error)
        }

        //TODO: at the moment always just start recording - we can mess with this later
        // by storing whether reocrding is already in progress so we know whether to stop it later
        this._instance.startSessionRecording(true)

        return feedbackId
    }

    private _handleStopped(feedbackRecordingId: string): UserFeedbackRecordingResult {
        this._instance.capture('$user_feedback_recording_stopped', {
            $feedback_recording_id: feedbackRecordingId,
        })

        return { feedback_id: feedbackRecordingId, session_id: this._instance.get_session_id() }
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

            const url = this._instance.requestRouter.endpointFor('api', `/api/feedback/audio`)

            this._instance._send_request({
                method: 'POST',
                url,
                data: {
                    token: this._instance.config.token,
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

    private async _stopFeedbackRecording(
        feedbackId: string,
        onRecordingEnded: (result: UserFeedbackRecordingResult) => void
    ): Promise<void> {
        const recordingResult = await this._audioRecorder.stopRecording()

        if (recordingResult?.blob) {
            logger.info(`Audio recording completed, blob size: ${recordingResult.blob.size} bytes`)
            this._uploadAudioBlob(feedbackId, recordingResult?.blob)
        }

        removeFeedbackRecordingUIFromDOM()
        onRecordingEnded(this._handleStopped(feedbackId))

        this._resetState()
    }

    private _showFeedbackRecordingUI(onRecordingEnded: (result: UserFeedbackRecordingResult) => void) {
        const _onRecordingEnded = async (feedbackId: string) => {
            await this._stopFeedbackRecording(feedbackId, onRecordingEnded)
        }

        const _onCancel = () => {
            this._resetState()
            logger.info('Feedback recording UI cancelled')
        }

        renderFeedbackRecordingUI({
            posthogInstance: this._instance,
            handleStartRecording: () => this._startFeedbackRecording(),
            onRecordingEnded: _onRecordingEnded,
            onCancel: _onCancel,
        })
    }

    private _resetState(): void {
        this._feedbackRecordingId = null
        this._isUIActive = false
    }
}

// Extension generator function for the extension system
export function generateFeedbackRecording(posthog: PostHog): FeedbackRecordingManager {
    return new FeedbackRecordingManager(posthog)
}
