import {
    getToolbarCacheBucket,
    getToolbarHashState,
    loadToolbar,
    readToolbarParams,
} from '@posthog/browser-common/toolbar'
import type { RequestRuntime } from '../../platform/request'
import type { IPostHog } from '../../core/types'
import type { ToolbarExtension, ToolbarOptions, ToolbarParams } from './toolbar-options'

const CLOUD_HOST = /^https:\/\/(app|us|us-assets|eu|eu-assets)(\.i)?\.posthog\.com$/i

const trimHost = (host: string): string => host.trim().replace(/\/+$/, '')

/** The app origin for an API host, matching posthog-js: Cloud ingestion hosts map to their app host. */
export const getUiHost = (apiHost: string): string => {
    const host = apiHost.replace('.i.posthog.com', '.posthog.com')
    return host === 'https://app.posthog.com' ? 'https://us.posthog.com' : host
}

/** Reads the toolbar state from the current URL hash. */
export const readLocationHashState = (): string | null => {
    try {
        return getToolbarHashState(globalThis.location?.hash ?? '')
    } catch {
        return null
    }
}

/** Inserts the toolbar script and calls back once. The returned function cancels a pending insertion or result. */
const insertScript = (url: string, options: ToolbarOptions, callback: (error?: unknown) => void): (() => void) => {
    let settled = false
    const finish = (error?: unknown): void => {
        if (settled) return
        settled = true
        callback(error)
    }
    const insert = (): void => {
        document.removeEventListener('DOMContentLoaded', insert)
        if (settled) return
        let script: HTMLScriptElement | null = document.createElement('script')
        script.type = 'text/javascript'
        script.crossOrigin = 'anonymous'
        script.src = url
        try {
            script = options.prepareScript ? options.prepareScript(script) : script
        } catch (error) {
            finish(error)
            return
        }
        if (!script) {
            finish(new Error('prepareScript returned null'))
            return
        }
        // prepareScript can return another element, so the handlers go on the one inserted.
        script.onload = () => finish()
        script.onerror = (error) => finish(error)
        const first = document.querySelector('body > script')
        if (first) first.parentNode?.insertBefore(script, first)
        else document.body.appendChild(script)
    }
    if (document.body) insert()
    // oxlint-disable-next-line posthog-js/no-add-event-listener
    else document.addEventListener('DOMContentLoaded', insert)
    return () => {
        document.removeEventListener('DOMContentLoaded', insert)
        // Release the page-wide load state so another client can load the toolbar.
        finish(new Error('The toolbar extension is disposed'))
    }
}

export const createToolbar = (options: ToolbarOptions, stateHash: string | null): ToolbarExtension => {
    let client: IPostHog | undefined
    let disposed = false
    const reloads = new Set<() => void>()
    const pendingLoads = new Set<() => void>()

    const watchPageReplacement = (reload: () => void): void => {
        const listener = (): void => {
            if (!disposed) reload()
        }
        reloads.add(listener)
        // oxlint-disable-next-line posthog-js/no-add-event-listener
        window.addEventListener('turbolinks:load', listener)
    }

    const load = (params?: ToolbarParams): boolean => {
        const posthog = client
        if (!posthog || disposed || typeof window === 'undefined') return false
        try {
            const hosts = (posthog as unknown as { _requestRuntime?: RequestRuntime })._requestRuntime?.[0]
            const apiHost = hosts?.api ?? ''
            const assetHost = trimHost(options.assetHost ?? '') || hosts?.assets || apiHost
            return loadToolbar(
                {
                    token: posthog.projectToken,
                    ...params,
                    apiURL: trimHost(options.uiHost ?? '') || getUiHost(apiHost),
                    ...(options.disableMetrics && !CLOUD_HOST.test(apiHost) ? { instrument: false } : {}),
                },
                // The toolbar application reads private posthog-js state from this instance, so it runs without one.
                undefined,
                // Cancelling a load on disposal is not a failure worth reporting.
                { warn: posthog.logger.warn, error: (...args) => !disposed && posthog.logger.error(...args) },
                (callback) => {
                    // The script loader can call back before it returns its cancel function.
                    const pending: { cancel?: () => void; done?: boolean } = {}
                    // Turbolinks reloads reuse this loader, so each one takes the current cache bucket.
                    const scriptUrl = `${assetHost}/static/toolbar.js?v=${posthog.library.version}&t=${getToolbarCacheBucket()}`
                    pending.cancel = insertScript(scriptUrl, options, (error) => {
                        pending.done = true
                        if (pending.cancel) pendingLoads.delete(pending.cancel)
                        callback(error)
                    })
                    if (!pending.done) pendingLoads.add(pending.cancel)
                },
                watchPageReplacement
            )
        } catch (error) {
            posthog.logger.error('Toolbar loading failed', error)
            return false
        }
    }

    return {
        name: 'toolbar',
        setup: (posthog: IPostHog) => {
            client = posthog
            if (typeof window === 'undefined' || typeof document === 'undefined') return
            let params: ToolbarParams | undefined
            try {
                params = readToolbarParams(
                    posthog.projectToken,
                    stateHash || readLocationHashState(),
                    window.location,
                    window.localStorage,
                    window.history
                )
            } catch {
                // Missing storage or malformed saved parameters leave the toolbar unloaded.
            }
            if (params) load(params)
        },
        loadToolbar: load,
        dispose: () => {
            disposed = true
            for (const cancel of Array.from(pendingLoads)) cancel()
            pendingLoads.clear()
            for (const listener of reloads) window.removeEventListener('turbolinks:load', listener)
            reloads.clear()
        },
    }
}
