import { assignableWindow, document, LazyLoadedSessionRecordingInterface, window } from '../../utils/globals'
import { PostHog } from '../../posthog-core'
import { RemoteConfig } from '../../types'
import { createLogger } from '../../utils/logger'
import { SESSION_RECORDING_ENABLED_SERVER_SIDE } from '../../constants'

const logger = createLogger('[Session-Recording-Loader]')

export const isSessionRecordingEnabled = (loader: SessionRecordingLoader) => {
    const enabled_server_side = !!loader.instance.get_property(SESSION_RECORDING_ENABLED_SERVER_SIDE)
    const enabled_client_side = !loader.instance.config.disable_session_recording
    return !!window && enabled_server_side && enabled_client_side
}

export class SessionRecordingLoader {
    get lazyLoaded(): LazyLoadedSessionRecordingInterface | undefined {
        return this._lazyLoadedSessionRecording
    }

    private _lazyLoadedSessionRecording: LazyLoadedSessionRecordingInterface | undefined

    constructor(readonly instance: PostHog, readonly isEnabled: (srl: SessionRecordingLoader) => boolean) {
        this.startIfEnabled()
    }

    public onRemoteConfig(response: RemoteConfig) {
        if (this.instance.persistence) {
            this._lazyLoadedSessionRecording?.onRemoteConfig(response)
        }
        this.startIfEnabled()
    }

    public startIfEnabled() {
        if (this.isEnabled(this)) {
            this.loadScript(() => {
                this.start()
            })
        }
    }

    private loadScript(cb: () => void): void {
        if (assignableWindow.__PosthogExtensions__?.initSessionRecording) {
            // already loaded
            cb()
        }
        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, 'session-recording', (err) => {
            if (err) {
                logger.error('failed to load script', err)
                return
            }
            cb()
        })
    }

    private start() {
        if (!document) {
            logger.error('`document` not found. Cannot start.')
            return
        }

        if (!this._lazyLoadedSessionRecording && assignableWindow.__PosthogExtensions__?.initSessionRecording) {
            this._lazyLoadedSessionRecording = assignableWindow.__PosthogExtensions__.initSessionRecording(
                this.instance
            )
            this._lazyLoadedSessionRecording.start()
        }
    }

    stop() {
        if (this._lazyLoadedSessionRecording) {
            this._lazyLoadedSessionRecording.stop()
            this._lazyLoadedSessionRecording = undefined
        }
    }
}
