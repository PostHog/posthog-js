import { _register_event, _try, loadScript } from '../utils'
import { PostHog } from '../posthog-core'
import { DecideResponse, ToolbarParams } from '../types'
import { POSTHOG_MANAGED_HOSTS } from './cloud'
import { _getHashParam } from '../utils/request-utils'
import { logger } from '../utils/logger'
import { window } from '../utils/globals'

// TRICKY: Many web frameworks will modify the route on load, potentially before posthog is initialized.
// To get ahead of this we grab it as soon as the posthog-js is parsed
const STATE_FROM_WINDOW = window.location
    ? _getHashParam(window.location.hash, '__posthog') || _getHashParam(location.hash, 'state')
    : null

export class Toolbar {
    instance: PostHog
    constructor(instance: PostHog) {
        this.instance = instance
    }

    afterDecideResponse(response: DecideResponse) {
        const toolbarParams: ToolbarParams =
            response['toolbarParams'] ||
            response['editorParams'] ||
            (response['toolbarVersion'] ? { toolbarVersion: response['toolbarVersion'] } : {})
        if (
            response['isAuthenticated'] &&
            toolbarParams['toolbarVersion'] &&
            toolbarParams['toolbarVersion'].indexOf('toolbar') === 0
        ) {
            this.loadToolbar({
                ...toolbarParams,
            })
        }
    }

    /**
     * To load the toolbar, we need an access token and other state. That state comes from one of three places:
     * 1. In the URL hash params
     * 2. From session storage under the key `toolbarParams` if the toolbar was initialized on a previous page
     */
    maybeLoadToolbar(
        location = window.location,
        localStorage: Storage | undefined = undefined,
        history = window.history
    ): boolean {
        try {
            // Before running the code we check if we can access localStorage, if not we opt-out
            if (!localStorage) {
                try {
                    window.localStorage.setItem('test', 'test')
                    window.localStorage.removeItem('test')
                } catch (error) {
                    return false
                }

                // If localStorage was undefined, and localStorage is supported we set the default value
                localStorage = window.localStorage
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
                ? _try(() => JSON.parse(atob(decodeURIComponent(stateHash)))) ||
                  _try(() => JSON.parse(decodeURIComponent(stateHash)))
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
                        history.replaceState('', document.title, location.pathname + location.search) // completely remove hash
                    } else {
                        location.hash = '' // clear hash (but leaves # unfortunately)
                    }
                }
            } else {
                // get credentials from localStorage from a previous initialzation
                toolbarParams = JSON.parse(localStorage.getItem('_postHogToolbarParams') || '{}')
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
        } catch (e) {
            return false
        }
    }

    loadToolbar(params?: ToolbarParams): boolean {
        if ((window as any)['_postHogToolbarLoaded']) {
            return false
        }
        // only load the toolbar once, even if there are multiple instances of PostHogLib
        ;(window as any)['_postHogToolbarLoaded'] = true

        const host = this.instance.config.api_host
        // toolbar.js is served from the PostHog CDN, this has a TTL of 24 hours.
        // the toolbar asset includes a rotating "token" that is valid for 5 minutes.
        const fiveMinutesInMillis = 5 * 60 * 1000
        // this ensures that we bust the cache periodically
        const timestampToNearestFiveMinutes = Math.floor(Date.now() / fiveMinutesInMillis) * fiveMinutesInMillis
        const toolbarUrl = `${host}${host.endsWith('/') ? '' : '/'}static/toolbar.js?t=${timestampToNearestFiveMinutes}`
        const disableToolbarMetrics =
            !POSTHOG_MANAGED_HOSTS.includes(this.instance.config.api_host) &&
            this.instance.config.advanced_disable_toolbar_metrics

        const toolbarParams = {
            token: this.instance.config.token,
            ...params,
            apiURL: host, // defaults to api_host from the instance config if nothing else set
            ...(disableToolbarMetrics ? { instrument: false } : {}),
        }

        const { source: _discard, ...paramsToPersist } = toolbarParams // eslint-disable-line
        window.localStorage.setItem('_postHogToolbarParams', JSON.stringify(paramsToPersist))

        loadScript(toolbarUrl, (err) => {
            if (err) {
                logger.error('Failed to load toolbar', err)
                return
            }
            ;((window as any)['ph_load_toolbar'] || (window as any)['ph_load_editor'])(toolbarParams, this.instance)
        })
        // Turbolinks doesn't fire an onload event but does replace the entire body, including the toolbar.
        // Thus, we ensure the toolbar is only loaded inside the body, and then reloaded on turbolinks:load.
        _register_event(window, 'turbolinks:load', () => {
            ;(window as any)['_postHogToolbarLoaded'] = false
            this.loadToolbar(toolbarParams)
        })
        return true
    }

    /** @deprecated Use "loadToolbar" instead. */
    _loadEditor(params: ToolbarParams): boolean {
        return this.loadToolbar(params)
    }

    /** @deprecated Use "maybeLoadToolbar" instead. */
    maybeLoadEditor(
        location = window.location,
        localStorage: Storage | undefined = undefined,
        history = window.history
    ): boolean {
        return this.maybeLoadToolbar(location, localStorage, history)
    }
}
