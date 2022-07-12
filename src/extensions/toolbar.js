import { loadScript } from '../autocapture-utils'

export class Toolbar {
    constructor(instance) {
        this.instance = instance
    }

    afterDecideResponse(response) {
        const editorParams =
            response['editorParams'] ||
            (response['toolbarVersion'] ? { toolbarVersion: response['toolbarVersion'] } : {})
        if (
            response['isAuthenticated'] &&
            editorParams['toolbarVersion'] &&
            editorParams['toolbarVersion'].indexOf('toolbar') === 0
        ) {
            this._loadEditor({
                ...editorParams,
                apiURL: this.instance.get_config('api_host'),
            })
        }
    }

    /**
     * To load the visual editor, we need an access token and other state. That state comes from one of three places:
     * 1. In the URL hash params if the customer is using an old snippet
     * 2. From session storage under the key `editorParams` if the editor was initialized on a previous page
     */
    maybeLoadEditor(location = window.location, localStorage, history = window.history) {
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
            const parseFromUrl = state && (state['action'] === 'mpeditor' || state['action'] === 'ph_authorize')
            let editorParams

            if (parseFromUrl) {
                // happens if they are initializing the editor using an old snippet
                editorParams = state

                if (editorParams && Object.keys(editorParams).length > 0) {
                    localStorage.setItem('_postHogEditorParams', JSON.stringify(editorParams))

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
                editorParams = JSON.parse(localStorage.getItem('_postHogEditorParams') || '{}')

                // delete "add-action" or other intent from editorParams, otherwise we'll have the same intent
                // every time we open the page (e.g. you just visiting your own site an hour later)
                delete editorParams.userIntent
            }

            editorParams['apiURL'] = this.instance.get_config('api_host')

            if (editorParams['token'] && this.instance.get_config('token') === editorParams['token']) {
                this._loadEditor(editorParams)
                return true
            } else {
                return false
            }
        } catch (e) {
            return false
        }
    }

    _loadEditor(editorParams) {
        if (!window['_postHogToolbarLoaded']) {
            // only load the codeless event editor once, even if there are multiple instances of PostHogLib
            window['_postHogToolbarLoaded'] = true
            const host = editorParams['jsURL'] || editorParams['apiURL'] || this.instance.get_config('api_host')
            const toolbarScript = 'toolbar.js'
            const editorUrl =
                host + (host.endsWith('/') ? '' : '/') + 'static/' + toolbarScript + '?_ts=' + new Date().getTime()
            const disableToolbarMetrics =
                this.instance.get_config('api_host') !== 'https://app.posthog.com' &&
                this.instance.get_config('advanced_disable_toolbar_metrics')
            editorParams = { ...editorParams, ...(disableToolbarMetrics ? { instrument: false } : {}) }
            loadScript(editorUrl, () => {
                window['ph_load_editor'](editorParams, this.instance)
            })
            // Turbolinks doesn't fire an onload event but does replace the entire page, including the toolbar
            _register_event(window, 'turbolinks:load', () => {
                window['_postHogToolbarLoaded'] = false
                this._loadEditor(editorParams)
            })
            return true
        }
        return false
    }
}
