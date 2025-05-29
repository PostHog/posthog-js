import { PostHog } from '../posthog-core'
import { assignableWindow, PostHogExtensionKind } from '../utils/globals'
import { createLogger } from '../utils/logger'

const logger = createLogger('[PostHog ExternalIntegrations]')

const logStartResult = (name: string, started: boolean) => {
    if (!started) {
        logger.warn(`${name} integration failed to start`)
    } else {
        logger.info(`${name} integration started`)
    }
}

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
                const started = assignableWindow.__PosthogExtensions__?.integrations?.intercom?.start(this._instance)
                logStartResult('Intercom', !!started)
            })
        }
        if (
            this._instance.config.integrations?.crispChat &&
            !assignableWindow.__PosthogExtensions__?.integrations?.crispChat
        ) {
            this._loadScript('crisp-chat-integration', () => {
                const started = assignableWindow.__PosthogExtensions__?.integrations?.crispChat?.start(this._instance)
                logStartResult('Crisp Chat', !!started)
            })
        }
    }
}
