import type { PostHog } from '../posthog-core'
import { assignableWindow, document, PostHogExtensionKind } from '../utils/globals'
import { createLogger } from '../utils/logger'

const logger = createLogger('[ExternalScriptsLoader]')

const loadScript = (posthog: PostHog, url: string, callback: (error?: string | Event, event?: Event) => void) => {
    if (posthog.config.disable_external_dependency_loading) {
        logger.warn(`${url} was requested but loading of external scripts is disabled.`)
        return callback('Loading of external scripts is disabled')
    }

    const addScript = () => {
        if (!document) {
            return callback('document not found')
        }
        const scriptTag = document.createElement('script')
        scriptTag.type = 'text/javascript'
        scriptTag.crossOrigin = 'anonymous'
        scriptTag.src = url
        scriptTag.onload = (event) => callback(undefined, event)
        scriptTag.onerror = (error) => callback(error)

        const scripts = document.querySelectorAll('body > script')
        if (scripts.length > 0) {
            scripts[0].parentNode?.insertBefore(scriptTag, scripts[0])
        } else {
            // In exceptional situations this call might load before the DOM is fully ready.
            document.body.appendChild(scriptTag)
        }
    }

    if (document?.body) {
        addScript()
    } else {
        document?.addEventListener('DOMContentLoaded', addScript)
    }
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.loadExternalDependency = (
    posthog: PostHog,
    kind: PostHogExtensionKind,
    callback: (error?: string | Event, event?: Event) => void
): void => {
    let scriptUrlToLoad = `/static/${kind}.js` + `?v=${posthog.version}`

    if (kind === 'remote-config') {
        scriptUrlToLoad = `/array/${posthog.config.token}/config.js`
    }

    if (kind === 'toolbar') {
        // toolbar.js is served from the PostHog CDN, this has a TTL of 24 hours.
        // the toolbar asset includes a rotating "token" that is valid for 5 minutes.
        const fiveMinutesInMillis = 5 * 60 * 1000
        // this ensures that we bust the cache periodically
        const timestampToNearestFiveMinutes = Math.floor(Date.now() / fiveMinutesInMillis) * fiveMinutesInMillis

        scriptUrlToLoad = `${scriptUrlToLoad}&t=${timestampToNearestFiveMinutes}`
    }
    const url = posthog.requestRouter.endpointFor('assets', scriptUrlToLoad)

    loadScript(posthog, url, callback)
}

assignableWindow.__PosthogExtensions__.loadSiteApp = (
    posthog: PostHog,
    url: string,
    callback: (error?: string | Event, event?: Event) => void
): void => {
    const scriptUrl = posthog.requestRouter.endpointFor('api', url)

    loadScript(posthog, scriptUrl, callback)
}
