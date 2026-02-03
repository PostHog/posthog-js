import { isUndefined } from '@posthog/core'
import { createLogger } from './utils/logger'
import { assignableWindow } from './utils/globals'
import { RemoteConfig, UserFeedbackRecordingResult } from './types'
import { PostHog } from './posthog-core'
import type { FeedbackRecordingManager } from './extensions/feedback-recording'

const logger = createLogger('[PostHog FeedbackManager]')

export class PostHogFeedbackRecording {
    private _isLoaded: boolean = false
    private _isLoading: boolean = false
    private _isUIActive: boolean = false
    private _isFeedbackRecordingEnabled?: boolean = undefined
    private _extension: FeedbackRecordingManager | null = null

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
        return this._extension?.getCurrentFeedbackRecordingId() ?? null
    }

    isFeedbackRecordingActive(): boolean {
        return this._extension?.isFeedbackRecordingActive() ?? false
    }

    public cleanup(): void {
        if (this._extension) {
            this._extension.cleanup()
        }

        this._isUIActive = false

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

        if (this._extension?.isFeedbackRecordingActive()) {
            logger.warn('Feedback recording is already in progress. Request to start a new recording will be ignored.')
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
        this._extension.launchFeedbackRecordingUI(
            (result) => {
                this._isUIActive = false
                ;(onRecordingEnded || (() => {}))(result)
            },
            () => {
                this._isUIActive = false
                logger.info('Feedback recording UI cancelled')
            }
        )
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
}
