import type { PostHog } from '../posthog-core'
import { document } from '@posthog/browser-common/utils/globals'
import { assignableWindow, PostHogExtensionKind } from '../utils/globals'
import { createLogger } from '@posthog/browser-common/utils/logger'

const logger = createLogger('[ExternalScriptsLoader]')

const findScript = (url: string): HTMLScriptElement | undefined => {
    const scripts = document?.querySelectorAll('script')
    if (scripts) {
        for (let i = 0; i < scripts.length; i++) {
            // `.src` reads back as a resolved absolute URL, but `url` is relative
            // whenever `api_host` is a path such as `/ingest`, so that comparison
            // alone never matches for reverse-proxied setups. The `src` attribute
            // holds exactly what `loadScript` wrote, so compare against both.
            if (scripts[i].src === url || scripts[i].getAttribute('src') === url) {
                return scripts[i]
            }
        }
    }
    return undefined
}

const loadScript = (posthog: PostHog, url: string, callback: (error?: string | Event, event?: Event) => void) => {
    if (posthog.config.disable_external_dependency_loading) {
        logger.warn(`${url} was requested but loading of external scripts is disabled.`)
        return callback('Loading of external scripts is disabled')
    }

    const addScript = () => {
        document?.removeEventListener('DOMContentLoaded', addScript)
        if (posthog.config.disable_external_dependency_loading) {
            return callback('Loading of external scripts is disabled')
        }
        if (!document) {
            return callback('document not found')
        }
        let scriptTag: HTMLScriptElement | null = document.createElement('script')
        scriptTag.type = 'text/javascript'
        scriptTag.crossOrigin = 'anonymous'
        scriptTag.src = url
        scriptTag.onload = (event) => {
            ;(scriptTag as any).__posthog_loading_callback_fired = true
            callback(undefined, event)
        }
        scriptTag.onerror = (error) => {
            ;(scriptTag as any).__posthog_loading_error = error
            callback(error)
        }

        if (posthog.config.prepare_external_dependency_script) {
            scriptTag = posthog.config.prepare_external_dependency_script(scriptTag)
        }

        if (!scriptTag) {
            return callback('prepare_external_dependency_script returned null')
        }

        // Preparation runs on a detached candidate, never on a shared script that
        // may already have executed. Match its final URL and security metadata:
        // changing attributes on the existing element cannot retroactively verify it.
        if (posthog.config.disable_external_dependency_loading) {
            return callback('Loading of external scripts is disabled')
        }
        const existingScript = findScript(scriptTag.src)
        if (existingScript) {
            if (
                existingScript.integrity !== scriptTag.integrity ||
                existingScript.crossOrigin !== scriptTag.crossOrigin ||
                existingScript.nonce !== scriptTag.nonce
            ) {
                return callback('Existing script conflicts with prepared script policy')
            }
            if ((existingScript as any).__posthog_loading_callback_fired) {
                return callback()
            }
            const existingError = (existingScript as any).__posthog_loading_error
            if (existingError) {
                return callback(existingError)
            }

            // oxlint-disable-next-line posthog-js/no-add-event-listener
            existingScript.addEventListener('load', (event) => {
                ;(existingScript as any).__posthog_loading_callback_fired = true
                callback(undefined, event)
            })
            // oxlint-disable-next-line posthog-js/no-add-event-listener
            existingScript.addEventListener('error', (error) => {
                ;(existingScript as any).__posthog_loading_error = error
                callback(error)
            })
            return
        }

        if (!document.body) {
            return waitForDocumentBody()
        }
        if (posthog.config.external_scripts_inject_target === 'head') {
            document.head.appendChild(scriptTag)
        } else {
            const scripts = document.querySelectorAll('body > script')
            if (scripts.length > 0) {
                scripts[0].parentNode?.insertBefore(scriptTag, scripts[0])
            } else {
                document.body.appendChild(scriptTag)
            }
        }
    }

    const waitForDocumentBody = () => {
        // Inlining this because we don't care about `passive: true` here
        // and this saves us ~3% of the bundle size
        // oxlint-disable-next-line posthog-js/no-add-event-listener
        document?.addEventListener('DOMContentLoaded', addScript)
    }

    if (document?.body || findScript(url)) {
        addScript()
    } else {
        waitForDocumentBody()
    }
}

const fallbackScripts: Record<string, string> = {}

const legacyScriptUrl = (posthog: PostHog, kind: PostHogExtensionKind): string => {
    let scriptPath = `/static/${kind}.js?v=${posthog.version}`

    if (kind === 'toolbar') {
        // toolbar.js has a 24-hour CDN TTL but contains a rotating token valid for
        // only 5 minutes. Bust the cache on a 5-minute boundary so the browser always
        // fetches a fresh copy with a valid token.
        const fiveMinutesInMillis = 5 * 60 * 1000
        const timestampToNearestFiveMinutes = Math.floor(Date.now() / fiveMinutesInMillis) * fiveMinutesInMillis
        scriptPath = `${scriptPath}&t=${timestampToNearestFiveMinutes}`
    }

    return posthog.requestRouter.endpointFor('assets', scriptPath)
}

assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
assignableWindow.__PosthogExtensions__.loadExternalDependency = (
    posthog: PostHog,
    kind: PostHogExtensionKind,
    callback: (error?: string | Event, event?: Event) => void
): void => {
    // remote-config always loads from the token-specific path
    if (kind === 'remote-config') {
        const url = posthog.requestRouter.endpointFor('assets', `/array/${posthog.config.token}/config.js`)
        loadScript(posthog, url, callback)
        return
    }

    const scriptVersioning = posthog.config.strict_script_versioning
    if (scriptVersioning) {
        // posthog.version is baked into the executing array.js bundle, so this points at
        // the exact semver-qualified sibling asset without relying on alias redirects.
        const url = posthog.requestRouter.endpointFor('assets', `/static/${posthog.version}/${kind}.js`)
        const existingFallback = fallbackScripts[url]
        if (scriptVersioning === 'fallback' && existingFallback) {
            if (findScript(existingFallback)) {
                loadScript(posthog, existingFallback, callback)
                return
            }
            delete fallbackScripts[url]
        }

        loadScript(
            posthog,
            url,
            scriptVersioning === 'fallback'
                ? (error, event) => {
                      if (!error) {
                          callback(undefined, event)
                      } else if (typeof error === 'string') {
                          callback(error)
                      } else {
                          const fallbackUrl = legacyScriptUrl(posthog, kind)
                          fallbackScripts[url] = fallbackUrl
                          const failedScript = findScript(url)
                          failedScript?.parentNode?.removeChild(failedScript)
                          loadScript(posthog, fallbackUrl, callback)
                      }
                  }
                : callback
        )
        return
    }

    loadScript(posthog, legacyScriptUrl(posthog, kind), callback)
}

assignableWindow.__PosthogExtensions__.loadSiteApp = (
    posthog: PostHog,
    url: string,
    callback: (error?: string | Event, event?: Event) => void
): void => {
    const scriptUrl = posthog.requestRouter.endpointFor('api', url)

    loadScript(posthog, scriptUrl, callback)
}
