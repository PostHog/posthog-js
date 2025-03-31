import { SESSION_RECORDING_IS_SAMPLED, SESSION_RECORDING_SAMPLE_RATE } from '../../../constants'
import { PostHog } from '../../../posthog-core'
import { SessionIdManager } from '../../../sessionid'
import { RemoteConfig } from '../../../types'
import { logger } from '../../../utils/logger'
import { isBoolean, isNullish, isNumber } from '../../../utils/type-utils'
import { sampleOnProperty } from '../../sampling'
import { LazyLoadedSessionRecordingSamplingInterface } from '../../../utils/globals'

export class SessionRecordingSampling implements LazyLoadedSessionRecordingSamplingInterface {
    samplingSessionListener: (() => void) | undefined = undefined
    private sessionManager: SessionIdManager

    get sampleRate(): number | null {
        const rate = this.instance.get_property(SESSION_RECORDING_SAMPLE_RATE)
        return isNumber(rate) ? rate : null
    }

    get isSampled() {
        const currentValue = this.instance.get_property(SESSION_RECORDING_IS_SAMPLED)
        return isBoolean(currentValue) ? currentValue : null
    }

    constructor(private readonly instance: PostHog) {
        const instanceSessionManager = this.instance.sessionManager
        if (!instanceSessionManager) {
            logger.error('started without valid sessionManager')
            throw new Error('Sampling started without valid sessionManager. This is a bug.')
        }
        this.sessionManager = instanceSessionManager
    }

    onRemoteConfig(response: RemoteConfig) {
        const receivedSampleRate = response.sessionRecording?.sampleRate

        const parsedSampleRate = isNullish(receivedSampleRate) ? null : parseFloat(receivedSampleRate)

        this.instance.persistence?.register({
            [SESSION_RECORDING_SAMPLE_RATE]: parsedSampleRate,
        })

        if (isNumber(this.sampleRate) && isNullish(this._samplingSessionListener)) {
            this._samplingSessionListener = this.sessionManager.onSessionId((oldSessionId, sessionId) => {
                this.makeSamplingDecision(oldSessionId, sessionId)
            })
        }
    }

    resetSampling() {
        this.instance.persistence?.register({
            [SESSION_RECORDING_SAMPLE_RATE]: null,
        })
    }

    makeSamplingDecision(oldSessionId: string, sessionId: string): boolean | null {
        const sessionIdChanged = oldSessionId !== sessionId

        // capture the current sample rate,
        // because it is re-used multiple times
        // and the bundler won't minimise any of the references
        const currentSampleRate = this.sampleRate

        if (!isNumber(currentSampleRate)) {
            this.resetSampling()
            return null
        }

        const storedIsSampled = this.isSampled

        /**
         * if we get this far then we should make a sampling decision.
         * When the session id changes or there is no stored sampling decision for this session id
         * then we should make a new decision.
         *
         * Otherwise, we should use the stored decision.
         */
        const makeDecision = sessionIdChanged || !isBoolean(storedIsSampled)
        const shouldSample = makeDecision ? sampleOnProperty(sessionId, currentSampleRate) : storedIsSampled

        if (makeDecision) {
            this.instance.persistence?.register({
                [SESSION_RECORDING_IS_SAMPLED]: shouldSample,
            })

            if (!shouldSample) {
                logger.warn(
                    `Sample rate (${currentSampleRate}) has determined that this sessionId (${sessionId}) will not be sent to the server.`
                )
            }
        }

        return shouldSample
    }
}
