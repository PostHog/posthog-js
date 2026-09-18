import { SessionRecording as SharedSessionRecording } from '@posthog/browser-common/replay/session-recording'
import type { ReplayHost } from '@posthog/browser-common/replay/host'
import { createDisposable } from '@posthog/browser-common'
import type { PostHog } from '../../posthog-core'
import { RemoteConfigLoader } from '../../remote-config'
import { COOKIELESS_ALWAYS } from '../../constants'
import { assignableWindow, type PostHogExtensionKind } from '../../utils/globals'
import { replayOptions } from './replay-options'

function createSessionRecording(instance: PostHog): SharedSessionRecording {
    const sessionManager = instance.sessionManager
    if (!sessionManager) {
        throw new Error('[SessionRecording] started without valid sessionManager. This is a bug.')
    }
    if (instance.config.cookieless_mode === COOKIELESS_ALWAYS) {
        throw new Error('[SessionRecording] cannot be used with cookieless_mode="always"')
    }
    let loadingSessionManager = sessionManager
    const host: ReplayHost = {
        get sessionActive() {
            return instance.sessionManager === loadingSessionManager
        },
        get isAllowed() {
            return !instance.consent.isOptedOut()
        },
        onSessionChange: (callback) => createDisposable(instance.sessionManager?.onSessionId(callback) || (() => {})),
        registerSessionProperties: (properties) => instance.register_for_session(properties),
        requestConfigRefresh: () => new RemoteConfigLoader(instance).load(),
        loadRecorder(script, callback) {
            loadingSessionManager = instance.sessionManager!
            const extensions = assignableWindow.__PosthogExtensions__
            if (extensions?.rrweb?.record && extensions.initSessionRecording) {
                return callback()
            } else if (extensions?.loadExternalDependency) {
                return extensions.loadExternalDependency(instance, script as PostHogExtensionKind, callback)
            } else {
                return false
            }
        },
        createRecorder(visible, forceAllowLocalhostNetworkCapture) {
            const recorder = assignableWindow.__PosthogExtensions__?.initSessionRecording?.(instance, visible)
            if (recorder) {
                // This historical property is exchanged with independently deployed recorder chunks.
                ;(
                    recorder as typeof recorder & { _forceAllowLocalhostNetworkCapture: boolean }
                )._forceAllowLocalhostNetworkCapture = forceAllowLocalhostNetworkCapture
            }
            return recorder
        },
    }
    instance._getBrowserClientAdapter().replay = host
    return new SharedSessionRecording(() => replayOptions(instance))
}

/** Preserves the browser SDK's constructable enrollment boundary without owning the implementation. */
export const SessionRecording = function (instance: PostHog) {
    return createSessionRecording(instance)
} as unknown as { new (instance: PostHog): SharedSessionRecording; prototype: SharedSessionRecording }
SessionRecording.prototype = SharedSessionRecording.prototype
export type SessionRecording = SharedSessionRecording
