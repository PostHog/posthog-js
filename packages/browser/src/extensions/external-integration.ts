import { PostHog } from '../posthog-core'
import { ExternalIntegrationKind } from '../types'
import { assignableWindow, ExternalExtensionKind } from '../utils/globals'
import { createLogger } from '../utils/logger'

const logger = createLogger('[PostHog ExternalIntegrations]')

const MAPPED_INTEGRATIONS: Record<ExternalIntegrationKind, ExternalExtensionKind> = {
    intercom: 'intercom-integration',
    crispChat: 'crisp-chat-integration',
}

export class ExternalIntegrations {
    constructor(private readonly _instance: PostHog) {}

    private _loadScript(name: ExternalExtensionKind, cb: () => void): void {
        assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this._instance, name, (err) => {
            if (err) {
                return logger.error('failed to load script', err)
            }
            cb()
        })
    }

    public startIfEnabledOrStop() {
        for (const [key, value] of Object.entries(this._instance.config.integrations ?? {})) {
            // if the integration is enabled, and not present, then load it
            if (value && !assignableWindow.__PosthogExtensions__?.integrations?.[key as ExternalIntegrationKind]) {
                this._loadScript(MAPPED_INTEGRATIONS[key as ExternalIntegrationKind], () => {
                    assignableWindow.__PosthogExtensions__?.integrations?.[key as ExternalIntegrationKind]?.start(
                        this._instance
                    )
                })
            }
            // if the integration is disabled, and present, then stop it
            if (!value && assignableWindow.__PosthogExtensions__?.integrations?.[key as ExternalIntegrationKind]) {
                assignableWindow.__PosthogExtensions__?.integrations?.[key as ExternalIntegrationKind]?.stop()
            }
        }
    }
}
