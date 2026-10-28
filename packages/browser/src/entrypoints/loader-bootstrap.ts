import { isFunction } from '@posthog/core'
import { document } from '@posthog/browser-common/utils/globals'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { assignableWindow } from '../utils/globals'
import { createPostHogStub } from '../utils/loader-stub'
import { getVersionedScriptURL } from '../utils/loader-script'

const logger = createLogger('[Loader bootstrap]')

function bootstrap(): void {
    const script = document?.currentScript
    if (!document || !script) {
        return
    }
    if (assignableWindow.posthog?.__SV || isFunction(assignableWindow.posthog?.init)) {
        return
    }
    const source = script.getAttribute('data-loader-src')?.trim()
    if (!source) {
        logger.critical('Missing data-loader-src')
        return
    }

    assignableWindow.posthog = Object.assign(createPostHogStub(), { __loaderPending: true })
    const url = document.createElement('a')
    url.href = source
    const loader = document.createElement('script')
    // Pin mutable aliases to this bootstrap's release, which supports its queue handoff.
    loader.src = getVersionedScriptURL(url, 'loader.js')
    loader.async = true
    loader.crossOrigin = 'anonymous'
    loader.nonce = script.nonce
    loader.setAttribute('data-defer-init', 'true')
    loader.onerror = () => logger.error('Failed to load the PostHog loader')
    script.parentNode?.insertBefore(loader, script.nextSibling)
}

bootstrap()
