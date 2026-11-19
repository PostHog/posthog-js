import type { ToolbarParams } from '@posthog/types'

import { TOOLBAR_ID } from './constants'
import { document, window } from './utils/globals'

/** Saved toolbar parameters. The toolbar application reads and clears this key too. */
export const TOOLBAR_PARAMS_KEY = '_postHogToolbarParams'

const UNINITIALIZED = 0
const LOADING = 1
const LOADED = 2
type ToolbarLoadState = typeof UNINITIALIZED | typeof LOADING | typeof LOADED

type ToolbarWindow = Window & {
    ph_toolbar_state?: ToolbarLoadState
    ph_load_toolbar?: (params: ToolbarParams, instance?: unknown) => void
    ph_load_editor?: (params: ToolbarParams, instance?: unknown) => void
}

/** Loads `toolbar.js`, then calls back once with any error. */
export type ToolbarScriptLoader = (callback: (error?: unknown) => void) => void

type ToolbarLogger = { warn(...args: unknown[]): void; error(...args: unknown[]): void }

/**
 * Reads the toolbar state from a URL hash. `__posthog` is current; `state` is the legacy name. Parameters must start
 * the hash or follow `&`, so names that merely end in `state` do not match.
 */
export const getToolbarHashState = (hash: string): string | null =>
    /(?:^|[#&?])__posthog=([^&]*)/.exec(hash)?.[1] || /(?:^|[#&?])state=([^&]*)/.exec(hash)?.[1] || null

const parseJson = (read: () => string): Record<string, unknown> | null => {
    try {
        return JSON.parse(read())
    } catch {
        return null
    }
}

/**
 * Reads toolbar parameters from a toolbar authorization redirect, clearing its hash, or else from a previous
 * toolbar session. Returns them only when they belong to the host's project.
 */
export const readToolbarParams = (
    token: string,
    stateHash: string | null,
    location: Location,
    storage: Pick<Storage, 'getItem'>,
    history: History | undefined
): ToolbarParams | undefined => {
    // The state is preferably base64 encoded, or else URL encoded.
    const state = stateHash
        ? parseJson(() => atob(decodeURIComponent(stateHash))) || parseJson(() => decodeURIComponent(stateHash))
        : null
    let params: ToolbarParams
    if (state && state['action'] === 'ph_authorize') {
        params = state as ToolbarParams
        params.source = 'url'
        if (Object.keys(params).length > 0) {
            if (state['desiredHash']) {
                location.hash = state['desiredHash'] as string
            } else if (history) {
                history.replaceState(history.state, '', location.pathname + location.search)
            } else {
                location.hash = ''
            }
        }
    } else {
        params = JSON.parse(storage.getItem(TOOLBAR_PARAMS_KEY) || '{}')
        params.source = 'localstorage'
        // A saved intent such as "add-action" applies to the session that requested it only.
        delete params.userIntent
    }
    return params.token && params.token === token ? params : undefined
}

/** Toolbar parameters with the PostHog app origin the toolbar authenticates against. */
export type ToolbarLoadParams = ToolbarParams & { apiURL: string }

const callToolbar = (params: ToolbarLoadParams, instance: unknown, logger: ToolbarLogger, win: ToolbarWindow): void => {
    const load = win.ph_load_toolbar || win.ph_load_editor
    if (typeof load !== 'function') {
        logger.warn('No toolbar load function found')
        return
    }
    load(params, instance)
}

/**
 * Loads the toolbar once per page, or reopens it, and saves its parameters for the next page. `params` must
 * already carry the project token and the app origin as `apiURL`. Returns false when the toolbar is running.
 *
 * @param instance - SDK instance handed to the toolbar application.
 * @param watchPageReplacement - Runs its callback when the page replaces its body, as Turbolinks does.
 */
export const loadToolbar = (
    params: ToolbarLoadParams,
    instance: unknown,
    logger: ToolbarLogger,
    loadScript: ToolbarScriptLoader,
    watchPageReplacement: (reload: () => void) => void
): boolean => {
    const win = window as ToolbarWindow | undefined
    // The toolbar clears the saved parameters when it closes, so a running toolbar owns them.
    if (!win || document?.getElementById(TOOLBAR_ID)) return false

    win.localStorage.setItem(TOOLBAR_PARAMS_KEY, JSON.stringify({ ...params, source: undefined }))

    // The state is global so several SDK instances on one page load the toolbar once.
    const state = win.ph_toolbar_state ?? UNINITIALIZED
    if (state === LOADED) {
        callToolbar(params, instance, logger, win)
    } else if (state === UNINITIALIZED) {
        win.ph_toolbar_state = LOADING
        loadScript((error) => {
            if (error) {
                logger.error('Failed to load the toolbar', error)
                win.ph_toolbar_state = UNINITIALIZED
                return
            }
            win.ph_toolbar_state = LOADED
            callToolbar(params, instance, logger, win)
        })
        let body = document?.body
        watchPageReplacement(() => {
            // Turbolinks also fires on the initial page load. A pending script stays in use until the body is replaced.
            if (win.ph_toolbar_state === LOADING && (!body || body === document?.body)) return
            body = document?.body
            win.ph_toolbar_state = UNINITIALIZED
            // This watcher keeps running, so a reload does not register another one.
            loadToolbar(params, instance, logger, loadScript, () => {})
        })
    }
    return true
}

/**
 * `toolbar.js` has a 24-hour CDN TTL but carries a rotating token valid for only 5 minutes. Loaders add this
 * 5-minute bucket to its URL so browsers fetch a copy with a valid token.
 */
export const getToolbarCacheBucket = (now = Date.now()): number => {
    const fiveMinutes = 5 * 60 * 1000
    return Math.floor(now / fiveMinutes) * fiveMinutes
}
