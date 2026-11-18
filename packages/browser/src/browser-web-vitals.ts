import { logger } from '@posthog/browser-common/utils/logger'
import { isUndefined } from '@posthog/core'

import { WebVitalsAutocapture, type WebVitalsAutocaptureOptions } from '@posthog/browser-common/web-vitals'
import type { PostHog } from './posthog-core'
import { assignableWindow } from './utils/globals'
import { getExtensionLoader } from './utils/extension-loader'

const loadWebVitalsObservers = (
    instance: PostHog,
    ...[getFlavor, onLoad]: Parameters<WebVitalsAutocaptureOptions['loadObservers']>
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
