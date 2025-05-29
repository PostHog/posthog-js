import { PostHog } from '../posthog-core'
import { assignableWindow, PostHogExtensionKind } from '../utils/globals'
import { createLogger } from '../utils/logger'

const logger = createLogger('[PostHog ExternalIntegrations]')

export class ExternalIntegrations {
    constructor(private readonly _instance: PostHog) {}

    private _loadScript(name: PostHogExtensionKind, cb: () => void): void {
        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this._instance, name, (err) => {
            if (err) {
                return logger.error('failed to load script', err)
            }
            cb()
        })
    }
    public startIfEnabledOrStop() {
        if (
            this._instance.config.integrations?.intercom &&
            !assignableWindow.__PosthogExtensions__?.integrations?.intercom
        ) {
            this._loadScript('intercom-integration', () => {
                assignableWindow.__PosthogExtensions__?.integrations?.intercom?.start(this._instance)
            })
        }
        if (
            this._instance.config.integrations?.crispChat &&
            !assignableWindow.__PosthogExtensions__?.integrations?.crispChat
        ) {
            this._loadScript('crisp-chat-integration', () => {
                assignableWindow.__PosthogExtensions__?.integrations?.crispChat?.start(this._instance)
            })
        }
    }
}
