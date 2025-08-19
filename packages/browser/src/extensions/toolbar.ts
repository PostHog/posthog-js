import { addEventListener, trySafe } from '../utils'
import { PostHog } from '../posthog-core'
import { ToolbarParams } from '../types'
import { _getHashParam } from '../utils/request-utils'
import { createLogger } from '../utils/logger'
import { window, document, assignableWindow } from '../utils/globals'
import { TOOLBAR_ID } from '../constants'
import { isFunction, isNullish } from '@posthog/core'

// TRICKY: Many web frameworks will modify the route on load, potentially before posthog is initialized.
// To get ahead of this we grab it as soon as the posthog-js is parsed
const STATE_FROM_WINDOW = window?.location
    ? _getHashParam(window.location.hash, '__posthog') || _getHashParam(location.hash, 'state')
    : null

const LOCALSTORAGE_KEY = '_postHogToolbarParams'

const logger = createLogger('[Toolbar]')

enum ToolbarState {
    UNINITIALIZED = 0,
    LOADING = 1,
    LOADED = 2,
}

export class Toolbar {
    instance: PostHog

    constructor(instance: PostHog) {
        this.instance = instance
    }

    // NOTE: We store the state of the toolbar in the global scope to avoid multiple instances of the SDK loading the toolbar
    private _setToolbarState(state: ToolbarState) {
        assignableWindow['ph_toolbar_state'] = state
    }

    private _getToolbarState(): ToolbarState {
        return assignableWindow['ph_toolbar_state'] ?? ToolbarState.UNINITIALIZED
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

            /**
             * Info about the state
             * The state is a json object
             * 1. (Legacy) The state can be `state={}` as a urlencoded object of info. In this case
             * 2. The state should now be found in `__posthog={}` and can be base64 encoded or urlencoded.
             * 3. Base64 encoding is preferred and will gradually be rolled out everywhere
             */

            const stateHash =
                STATE_FROM_WINDOW || _getHashParam(location.hash, '__posthog') || _getHashParam(location.hash, 'state')

            let toolbarParams: ToolbarParams
            const state = stateHash
                ? trySafe(() => JSON.parse(atob(decodeURIComponent(stateHash)))) ||
                  trySafe(() => JSON.parse(decodeURIComponent(stateHash)))
                : null

            const parseFromUrl = state && state['action'] === 'ph_authorize'

            if (parseFromUrl) {
                // happens if they are initializing the toolbar using an old snippet
                toolbarParams = state
                toolbarParams.source = 'url'

                if (toolbarParams && Object.keys(toolbarParams).length > 0) {
                    if (state['desiredHash']) {
                        // hash that was in the url before the redirect
                        location.hash = state['desiredHash']
                    } else if (history) {
                        // second param is unused see https://developer.mozilla.org/en-US/docs/Web/API/History/replaceState
                        history.replaceState(history.state, '', location.pathname + location.search) // completely remove hash
                    } else {
                        location.hash = '' // clear hash (but leaves # unfortunately)
                    }
                }
            } else {
                // get credentials from localStorage from a previous initialization

                toolbarParams = JSON.parse(localStorage.getItem(LOCALSTORAGE_KEY) || '{}')
                toolbarParams.source = 'localstorage'

                // delete "add-action" or other intent from toolbarParams, otherwise we'll have the same intent
                // every time we open the page (e.g. you just visiting your own site an hour later)
                delete toolbarParams.userIntent
            }

            if (toolbarParams['token'] && this.instance.config.token === toolbarParams['token']) {
                this.loadToolbar(toolbarParams)
                return true
            } else {
                return false
            }
        } catch {
            return false
        }
    }

    private _callLoadToolbar(params: ToolbarParams) {
        const loadFn = assignableWindow['ph_load_toolbar'] || assignableWindow['ph_load_editor']
        if (isNullish(loadFn) || !isFunction(loadFn)) {
            logger.warn('No toolbar load function found')
            return
        }
        loadFn(params, this.instance)
    }

    loadToolbar(params?: ToolbarParams): boolean {
        const toolbarRunning = !!document?.getElementById(TOOLBAR_ID)

        if (!window || toolbarRunning) {
            // The toolbar will clear the localStorage key when it's done with it. If it is present that indicates the toolbar is already open and running
            return false
        }

        const disableToolbarMetrics =
            this.instance.requestRouter.region === 'custom' && this.instance.config.advanced_disable_toolbar_metrics

        const toolbarParams = {
            token: this.instance.config.token,
            ...params,
            apiURL: this.instance.requestRouter.endpointFor('ui'),
            ...(disableToolbarMetrics ? { instrument: false } : {}),
        }
        window.localStorage.setItem(
            LOCALSTORAGE_KEY,
            JSON.stringify({
                ...toolbarParams,
                source: undefined,
            })
        )

        if (this._getToolbarState() === ToolbarState.LOADED) {
            this._callLoadToolbar(toolbarParams)
        } else if (this._getToolbarState() === ToolbarState.UNINITIALIZED) {
            // only load the toolbar once, even if there are multiple instances of PostHogLib
            this._setToolbarState(ToolbarState.LOADING)

            assignableWindow.__PosthogExtensions__?.loadExternalDependency?.(this.instance, 'toolbar', (err) => {
                if (err) {
                    logger.error('[Toolbar] Failed to load', err)
                    this._setToolbarState(ToolbarState.UNINITIALIZED)
                    return
                }
                this._setToolbarState(ToolbarState.LOADED)
                this._callLoadToolbar(toolbarParams)
            })

            // Turbolinks doesn't fire an onload event but does replace the entire body, including the toolbar.
            // Thus, we ensure the toolbar is only loaded inside the body, and then reloaded on turbolinks:load.
            addEventListener(window, 'turbolinks:load', () => {
                this._setToolbarState(ToolbarState.UNINITIALIZED)
                this.loadToolbar(toolbarParams)
            })
        }

        return true
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
