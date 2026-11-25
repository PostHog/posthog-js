import { logger } from '@posthog/browser-common/utils/logger'
import { isUndefined } from '@posthog/core'

import { WebVitalsAutocapture, type WebVitalsAutocaptureOptions } from '@posthog/browser-common/web-vitals'
import type { PostHog } from './posthog-core'
import { assignableWindow } from './utils/globals'
import { getExtensionLoader } from './utils/extension-loader'

type LoadObserversArgs = Parameters<WebVitalsAutocaptureOptions['loadObservers']>

// Explicit parameters, not a destructured rest parameter, keep the ES6 bundle within ES2015 syntax.
const loadWebVitalsObservers = (
    instance: PostHog,
    getFlavor: LoadObserversArgs[0],
    onLoad: LoadObserversArgs[1]
): void => {
    const getCallbacks = () => {
        const flavor = getFlavor()
        const extensions = assignableWindow.__PosthogExtensions__
        const callbacksByFlavor = extensions?.postHogWebVitalsCallbacksByFlavor
        return (
            callbacksByFlavor?.[flavor] ||
            (flavor === 'web-vitals' && isUndefined(callbacksByFlavor)
                ? extensions?.postHogWebVitalsCallbacks
                : undefined)
        )
    }

    const preloaded = getCallbacks()
    if (preloaded) {
        onLoad(preloaded)
        return
    }

    getExtensionLoader(instance)?.(instance, getFlavor(), (error) => {
        if (error) {
            logger.error('[Web Vitals] failed to load script', error)
            return
        }
        // set_config can change the requested flavor while the script is in flight.
        const callbacks = getCallbacks()
        if (callbacks) onLoad(callbacks)
        else logger.error('[Web Vitals] callbacks not loaded - not starting')
    })
}

/** PostHog v1 configuration and CDN script loading for web vitals. */
export class BrowserWebVitalsAutocapture extends WebVitalsAutocapture {
    constructor(instance: PostHog) {
        super({
            getConfig: () => instance.config,
            loadObservers: (getFlavor, onLoad) => loadWebVitalsObservers(instance, getFlavor, onLoad),
        })
    }
}
