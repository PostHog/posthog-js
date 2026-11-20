import { addEventListener, isToolbarInstance } from '@posthog/browser-common/utils/general-utils'
import { PostHog } from '../posthog-core'
import { ToolbarParams } from '../types'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { window, document } from '@posthog/browser-common/utils/globals'
import { _getHashParam } from '@posthog/browser-common/utils/request-utils'
import { loadToolbar, readToolbarParams } from '@posthog/browser-common/toolbar'
import { Extension } from './types'
import { getExtensionLoader } from '../utils/extension-loader'

// TRICKY: Many web frameworks will modify the route on load, potentially before posthog is initialized.
// To get ahead of this we grab it as soon as the posthog-js is parsed
// The read only matters when the toolbar is bundled; do not copy this annotation onto initialization that must always run.
const STATE_FROM_WINDOW = /* @__PURE__ */ (() =>
    window?.location
        ? _getHashParam(window.location.hash, '__posthog') || _getHashParam(location.hash, 'state')
        : null)()

const logger = /* @__PURE__ */ createLogger('[Toolbar]')

export class Toolbar implements Extension {
    instance: PostHog

    constructor(instance: PostHog) {
        this.instance = instance
    }

    initialize(): boolean {
        return this.maybeLoadToolbar()
    }

    /**
     * To load the toolbar, we need an access token and other state. That state comes from one of three places:
     * 1. In the URL hash params
     * 2. From session storage under the key `toolbarParams` if the toolbar was initialized on a previous page
     */
    maybeLoadToolbar(
        location: Location | undefined = undefined,
        localStorage: Storage | undefined = undefined,
        history: History | undefined = undefined
    ): boolean {
        // don't load the toolbar on the toolbar :)
        if (isToolbarInstance(this.instance.config)) {
            return false
        }
        if (!window || !document) {
            return false
        }
        location = location ?? window.location
        history = history ?? window.history

        try {
            // Before running the code we check if we can access localStorage, if not we opt-out
            if (!localStorage) {
                try {
                    window.localStorage.setItem('test', 'test')
                    window.localStorage.removeItem('test')
                } catch {
                    return false
                }

                // If localStorage was undefined, and localStorage is supported we set the default value
                localStorage = window?.localStorage
            }

            const params = readToolbarParams(
                this.instance.config.token,
                STATE_FROM_WINDOW || _getHashParam(location.hash, '__posthog') || _getHashParam(location.hash, 'state'),
                location,
                localStorage,
                history
            )
            if (!params) return false
            // Found params mean true even when a toolbar is already running, as before.
            this.loadToolbar(params)
            return true
        } catch {
            return false
        }
    }

    loadToolbar(params?: ToolbarParams): boolean {
        const disableToolbarMetrics =
            this.instance.requestRouter.region === 'custom' && this.instance.config.advanced_disable_toolbar_metrics

        return loadToolbar(
            {
                token: this.instance.config.token,
                ...params,
                apiURL: this.instance.requestRouter.endpointFor('ui'),
                ...(disableToolbarMetrics ? { instrument: false } : {}),
            },
            this.instance,
            logger,
            (callback) => getExtensionLoader(this.instance)?.(this.instance, 'toolbar', callback),
            // Turbolinks doesn't fire an onload event but does replace the entire body, including the toolbar.
            // Thus, we ensure the toolbar is only loaded inside the body, and then reloaded on turbolinks:load.
            (reload) => addEventListener(window, 'turbolinks:load', reload)
        )
    }

    /** @deprecated Use "loadToolbar" instead. */
    _loadEditor(params: ToolbarParams): boolean {
        return this.loadToolbar(params)
    }

    /** @deprecated Use "maybeLoadToolbar" instead. */
    maybeLoadEditor(
        location: Location | undefined = undefined,
        localStorage: Storage | undefined = undefined,
        history: History | undefined = undefined
    ): boolean {
        return this.maybeLoadToolbar(location, localStorage, history)
    }
}
