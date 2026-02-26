import { isUndefined } from '@posthog/core'
import { PostHog } from '../posthog-core'
import { assignableWindow, LazyLoadedFeedbackRecordingInterface } from '../utils/globals'
import { createLogger } from '../utils/logger'
import { RemoteConfig, UserFeedbackRecordingResult } from '../types'

const logger = createLogger('[FeedbackRecording]')

export class FeedbackRecording {
    private _isLoaded: boolean = false
    private _isLoading: boolean = false
    private _isUIActive: boolean = false
    private _isFeedbackRecordingEnabled?: boolean = undefined
    private _lazyLoadedFeedbackRecording: LazyLoadedFeedbackRecordingInterface | null = null

    constructor(private _instance: PostHog) {
        this._isLoaded = !!assignableWindow?.__PosthogExtensions__?.initFeedbackRecording
    }

    onRemoteConfig(response: RemoteConfig): void {
        if (this._instance.config._experimental_disable_feedback_recording) {
            return
        }

        this._isFeedbackRecordingEnabled = !!response.feedbackRecording
    }

    getCurrentFeedbackRecordingId(): string | null {
        return this._lazyLoadedFeedbackRecording?.getCurrentFeedbackRecordingId() ?? null
    }

    isFeedbackRecordingActive(): boolean {
        return this._lazyLoadedFeedbackRecording?.isFeedbackRecordingActive() ?? false
    }

    public cleanup(): void {
        if (this._lazyLoadedFeedbackRecording) {
            this._lazyLoadedFeedbackRecording.cleanup()
            this._lazyLoadedFeedbackRecording = null
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

        if (this._lazyLoadedFeedbackRecording?.isFeedbackRecordingActive()) {
            logger.warn('Feedback recording is already in progress. Request to start a new recording will be ignored.')
            return
        }

        if (!this._isLoaded) {
            if (this._isLoading) {
                logger.info('Feedback recording is already loading...')
                return
            }

            await this._loadScript()

            if (!this._isLoaded) {
                logger.error('Failed to load feedback recording')
                return
            }
        }

        if (!this._lazyLoadedFeedbackRecording) {
            const init = assignableWindow.__PosthogExtensions__?.initFeedbackRecording
            if (init) {
                this._lazyLoadedFeedbackRecording = init(this._instance)
            }
        }

        if (!this._lazyLoadedFeedbackRecording) {
            logger.error('Failed to initialize feedback recording extension')
            return
        }

        this._isUIActive = true
        this._lazyLoadedFeedbackRecording.launchFeedbackRecordingUI(
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

    private _loadScript(): Promise<void> {
        if (assignableWindow.__PosthogExtensions__?.initFeedbackRecording) {
            this._isLoaded = true
            return Promise.resolve()
        }

        const loadExternalDependency = assignableWindow.__PosthogExtensions__?.loadExternalDependency

        if (!loadExternalDependency) {
            logger.error('PostHog loadExternalDependency extension not found')
            return Promise.resolve()
        }

        this._isLoading = true

        // eslint-disable-next-line compat/compat
        return new Promise((resolve) => {
            loadExternalDependency(this._instance, 'feedback-recording', (err) => {
                this._isLoading = false
                if (err || !assignableWindow.__PosthogExtensions__?.initFeedbackRecording) {
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
