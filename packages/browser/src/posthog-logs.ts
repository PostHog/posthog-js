import { PostHog } from './posthog-core'
import { RemoteConfig } from './types'
import { isNullish } from '@posthog/core'
import { assignableWindow } from './utils/globals'
import { createLogger } from './utils/logger'

export class PostHogLogs {
    private _isLogsEnabled?: boolean

    constructor(private readonly _instance: PostHog) {}

    onRemoteConfig(response: RemoteConfig) {
        // only load logs if they are enabled
        const logCapture = response.logs?.captureConsoleLogs
        if (isNullish(logCapture) || !logCapture) {
            return
        }
        this._isLogsEnabled = true
        this.loadIfEnabled()
    }

    reset(): void {}

    loadIfEnabled() {
        if (!this._isLogsEnabled) {
            return
        }

        const logger = createLogger('[logs]')
        const phExtensions = assignableWindow?.__PosthogExtensions__
        if (!phExtensions) {
            logger.error('PostHog Extensions not found.')
            return
        }

        const loadExternalDependency = phExtensions.loadExternalDependency
        if (!loadExternalDependency) {
            logger.error('PostHog loadExternalDependency extension not found.')
            return
        }

        loadExternalDependency(this._instance, 'logs', (err) => {
            if (err || !phExtensions.initializeLogs) {
                logger.error('Could not load logs script', err)
            } else {
                // Need to get the function reference again inside the callback
                phExtensions.initializeLogs(this._instance)
            }
        })
    }
}
