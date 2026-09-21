import { createDisposable } from '@posthog/browser-common'
import type { ReplayRecorderClient, ReplayRecorderHost } from '@posthog/browser-common/replay/host'
import { logger } from '@posthog/browser-common/utils/logger'
import { getTargetingUrl } from '@posthog/browser-common/utils/url-targeting-utils'
import { isFunction } from '@posthog/core'
import Config from '../../config'
import { SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP, SESSION_RECORDING_FLUSHED_SIZE } from '../../constants'
import type { PostHog } from '../../posthog-core'
import { sessionStore } from '../../storage'
import { BrowserClientKeyValueStore } from '../browser-client-kv'

export { replayOptions } from './replay-options'

/** Browser-owned compatibility boundary for independently loaded recorder chunks. */
export function createReplayRecorderHost(instance: PostHog): ReplayRecorderHost {
    const sessionManager = instance.sessionManager
    if (!sessionManager) {
        throw new Error('[SessionRecording] must be started with a valid sessionManager.')
    }
    const sessionActive = () => instance.sessionManager === sessionManager
    return {
        get sessionActive() {
            return sessionActive()
        },
        get sessionTimeoutMs() {
            return sessionManager.sessionTimeoutMs
        },
        checkSession(options) {
            return sessionManager.checkAndGetSessionAndWindowId(options?.updateActivity === false, options?.timestamp)
        },
        onSessionChange(callback) {
            return createDisposable(
                sessionManager.onSessionId((...args) => {
                    if (sessionActive()) {
                        callback(...args)
                    }
                })
            )
        },
        onForcedIdle(callback) {
            // The unversioned recorder also runs with cores from before 1.268.6.
            if (!isFunction(sessionManager.on)) {
                logger.warn(
                    '[SessionRecording]',
                    'bundled core has no SessionIdManager.on (requires posthog-js >= 1.268.6); ' +
                        'recording will start but skip forced-idle-reset handling'
                )
                return undefined
            }
            return createDisposable(
                sessionManager.on('forcedIdleReset', () => {
                    if (sessionActive()) {
                        callback()
                    }
                })
            )
        },
        onFlags(callback) {
            return createDisposable(instance.onFeatureFlags((_flags, variants) => callback(variants)))
        },
        get targetingUrl() {
            return getTargetingUrl(instance)
        },
        isIngestionEndpoint(url) {
            return isFunction(instance.requestRouter.isIngestionEndpoint)
                ? instance.requestRouter.isIngestionEndpoint(url)
                : false
        },
        registerSessionProperties(properties) {
            instance.register_for_session(properties)
        },
        captureSnapshot(endpoint, properties) {
            instance.capture('$snapshot', properties, {
                _url: instance.requestRouter.endpointFor('api', endpoint),
                _noTruncate: true,
                _batchKey: 'recordings',
                skip_client_rate_limiting: true,
            })
        },
        createPendingBufferStore() {
            const key =
                'ph_replay_pending_buffer_' +
                JSON.stringify([instance.config.persistence_name || instance.config.token, instance.config.token])
            const enabled = () =>
                instance.config.persistence !== 'memory' &&
                instance.persistence?._disabled !== true &&
                sessionStore._is_supported()
            return {
                get enabled() {
                    return enabled()
                },
                read: () => (enabled() ? sessionStore._parse(key) : undefined),
                write: (value) => {
                    if (enabled()) {
                        sessionStore._set(key, value)
                    }
                },
                // Removal is allowed after persistence is disabled, including a cancelled unload's cleanup.
                remove: () => sessionStore._remove(key),
            }
        },
        createFlushedSizeWriter: () => createReplayFlushedSizeWriter(instance),
        recordFirstSnapshot(timestamp) {
            instance.persistence?.register_once(
                { [SESSION_RECORDING_FIRST_FULL_SNAPSHOT_TIMESTAMP]: timestamp },
                undefined
            )
        },
        emitConfigEvent(emit) {
            emit('$posthog_config', { config: instance.config })
        },
    }
}

export function createReplayRecorderClient(instance: PostHog): ReplayRecorderClient {
    return {
        kv: new BrowserClientKeyValueStore(instance),
        replay: createReplayRecorderHost(instance),
        get library() {
            return { name: Config.LIB_NAME, version: Config.LIB_VERSION }
        },
        logger,
        onEvent(callback) {
            return createDisposable(instance.on('eventCaptured', (event) => callback(event)))
        },
    }
}

export function createReplayFlushedSizeWriter(instance: PostHog) {
    const persistence = instance.persistence
    if (!persistence) {
        throw new Error('it is not valid to not have persistence and be this far into setting up the application')
    }
    return (value: { sessionId: string; size: number }) =>
        persistence.set_property(SESSION_RECORDING_FLUSHED_SIZE, value)
}
