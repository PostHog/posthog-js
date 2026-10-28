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
    const source = script.getAttribute('data-asset-host')?.trim()
    if (!source) {
        logger.critical('Missing data-asset-host')
        return
    }

    const url = document.createElement('a')
    url.href = source
    if (!/^https?:$/.test(url.protocol) || url.search || url.hash || /\.js\/?$/i.test(url.pathname)) {
        logger.critical(
            'Set data-asset-host to an HTTP(S) asset host or proxy prefix, not a script URL, query, or fragment. Pass the project token to posthog.init().'
        )
        return
    }

    assignableWindow.posthog = createPostHogStub()
    url.pathname = url.pathname.replace(/\/+$/, '') + '/static/'
    const core = document.createElement('script')
    core.src = getVersionedScriptURL(url)
    core.async = true
    core.crossOrigin = 'anonymous'
    core.nonce = script.nonce
    core.onerror = () => logger.error('Failed to load the PostHog SDK')
    script.parentNode?.insertBefore(core, script.nextSibling)
}

bootstrap()
