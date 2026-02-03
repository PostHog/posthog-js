import { isNull, isUndefined } from '@posthog/core'
import { createLogger } from './utils/logger'
import { uuidv7 } from './uuidv7'
import { assignableWindow } from './utils/globals'
import { RemoteConfig, RequestResponse, UserFeedbackRecordingResult } from './types'
import { PostHog } from './posthog-core'

const logger = createLogger('[PostHog FeedbackManager]')

const MAX_AUDIO_SIZE = 10 * 1024 * 1024 // 10MB limit to match backend

export class FeedbackRecordingManager {
    private _feedbackRecordingId: string | null = null
    private _isLoaded: boolean = false
    private _isLoading: boolean = false
    private _isUIActive: boolean = false
    private _didStartSessionRecording: boolean = false
    private _isFeedbackRecordingEnabled?: boolean = undefined
    private _extension: any = null

    constructor(private _instance: PostHog) {
        this._isLoaded = !!assignableWindow?.__PosthogExtensions__?.generateFeedbackRecording
    }

    onRemoteConfig(response: RemoteConfig): void {
        if (this._instance.config._experimental_disable_feedback_recording) {
            return
        }

        this._isFeedbackRecordingEnabled = !!response.feedbackRecording
    }

    getCurrentFeedbackRecordingId(): string | null {
        return this._feedbackRecordingId
    }

    isFeedbackRecordingActive(): boolean {
        return !isNull(this._feedbackRecordingId)
    }

    public cleanup(): void {
        if (this._extension) {
            if (this._extension.isAudioRecording()) {
                this._extension.cancelAudioRecording()
            }
            this._extension.removeUI()
        }

        if (this._didStartSessionRecording) {
            this._instance.stopSessionRecording()
            logger.info('Stopped session recording during cleanup')
        }

        this._resetState()

        logger.info('Feedback recording cleaned up')
    }

    async launchFeedbackRecordingUI(onRecordingEnded?: (result: UserFeedbackRecordingResult) => void): Promise<void> {
        if (this._instance.config._experimental_disable_feedback_recording) {
            logger.info('Feedback recording is disabled via config.')
            return
        }

        if (isUndefined(this._isFeedbackRecordingEnabled)) {
            logger.info('Feedback recording remote config not loaded yet.')
            return
        }

        if (!this._isFeedbackRecordingEnabled) {
            logger.info('Feedback recording is not enabled for this project.')
            return
        }

        if (this._instance.config.disable_session_recording || !this._instance.sessionRecording) {
            logger.info('Feedback recording requires session recording to be enabled and loaded.')
            return
        }

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

        if (!this._isLoaded) {
            if (this._isLoading) {
                logger.info('Feedback recording is already loading...')
                return
            }

            await this._loadFeedbackRecording()

            // eslint-disable-next-line compat/compat
            if (!this._isLoaded) {
                logger.error('Failed to load feedback recording')
                return
            }
        }

        if (!this._extension) {
            const generate = assignableWindow.__PosthogExtensions__?.generateFeedbackRecording
            if (generate) {
                this._extension = generate(this._instance)
            }
        }

        if (!this._extension) {
            logger.error('Failed to initialize feedback recording extension')
            return
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
            this._isLoaded = true
            return
        }

        const loadExternalDependency = phExtensions.loadExternalDependency

        if (!loadExternalDependency) {
            logger.error('PostHog loadExternalDependency extension not found')
            return
        }

        this._isLoading = true

        // eslint-disable-next-line compat/compat
        return new Promise((resolve) => {
            loadExternalDependency(this._instance, 'feedback-recording', (err) => {
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
            await this._extension.startAudioRecording()
        } catch (error) {
            logger.warn('Failed to start audio recording:', error)
        }

        const wasSessionRecordingActive = this._instance.sessionRecordingStarted()
        if (!wasSessionRecordingActive) {
            this._instance.startSessionRecording(true)
            this._didStartSessionRecording = true
            logger.info('Started session recording for feedback')
        } else {
            this._didStartSessionRecording = false
            logger.info('Session recording already active, reusing existing recording')
        }

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
        if (this._didStartSessionRecording) {
            this._instance.stopSessionRecording()
            logger.info('Stopped session recording after feedback recording ended')
        }

        const recordingResult = await this._extension.stopAudioRecording()

        if (recordingResult?.blob) {
            logger.info(`Audio recording completed, blob size: ${recordingResult.blob.size} bytes`)
            this._uploadAudioBlob(feedbackId, recordingResult.blob)
        }

        this._extension.removeUI()
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

        this._extension.renderFeedbackRecordingUI({
            posthogInstance: this._instance,
            handleStartRecording: () => this._startFeedbackRecording(),
            onRecordingEnded: _onRecordingEnded,
            onCancel: _onCancel,
        })
    }

    private _resetState(): void {
        this._feedbackRecordingId = null
        this._isUIActive = false
        this._didStartSessionRecording = false
    }
}
