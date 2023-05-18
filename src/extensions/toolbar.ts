import { _getHashParam, _register_event, loadScript, logger } from '../utils'
import { PostHog } from '../posthog-core'
import { DecideResponse, ToolbarParams } from '../types'
import { POSTHOG_MANAGED_HOSTS } from './cloud'

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

            const stateHash = _getHashParam(location.hash, '__posthog') || _getHashParam(location.hash, 'state')
            const state = stateHash ? JSON.parse(decodeURIComponent(stateHash)) : null
            const parseFromUrl = state && state['action'] === 'ph_authorize'
            let toolbarParams: ToolbarParams

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

            if (toolbarParams['token'] && this.instance.get_config('token') === toolbarParams['token']) {
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

        // By design array.js, recorder.js, and toolbar.js are served from Django with no or limited caching, not from our CDN
        // Django respects the query params for caching, returning a 304 if appropriate
        const host = this.instance.get_config('api_host')
        const timestampToNearestThirtySeconds = Math.floor(Date.now() / 30000) * 30000
        const toolbarUrl = `${host}${
            host.endsWith('/') ? '' : '/'
        }static/toolbar.js?_ts=${timestampToNearestThirtySeconds}`
        const disableToolbarMetrics =
            !POSTHOG_MANAGED_HOSTS.includes(this.instance.get_config('api_host')) &&
            this.instance.get_config('advanced_disable_toolbar_metrics')

        const toolbarParams = {
            token: this.instance.get_config('token'),
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
