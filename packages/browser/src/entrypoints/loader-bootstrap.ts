import { isFunction } from '@posthog/core'
import { document } from '@posthog/browser-common/utils/globals'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { assignableWindow } from '../utils/globals'
import { createPostHogStub } from '../utils/loader-stub'

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
    if (
        !/^(https?:\/\/|\/)/i.test(source) ||
        !/^https?:$/.test(url.protocol) ||
        /\/static(\/|$)/.test(url.pathname) ||
        url.search ||
        url.hash ||
        /\.js\/?$/i.test(url.pathname)
    ) {
        logger.critical(
            'Use an http(s):// asset host or /proxy prefix without /static, a script filename, query, or fragment. Pass the project token to posthog.init().'
        )
        return
    }

    const sdkVersion = script.getAttribute('data-sdk-version')?.trim()
    if (sdkVersion && !/^\d+(?:\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)?$/.test(sdkVersion)) {
        logger.critical('data-sdk-version must be a major or full SDK version; omit it to load the latest SDK.')
        return
    }

    assignableWindow.posthog = createPostHogStub()
    const namespace = sdkVersion ? `${sdkVersion}/` : ''
    url.pathname = url.pathname.replace(/\/+$/, '') + `/static/${namespace}array.js`
    const core = document.createElement('script')
    core.src = url.href
    core.async = true
    core.crossOrigin = 'anonymous'
    core.nonce = script.nonce
    core.onerror = () => logger.error('Failed to load the PostHog SDK')
    script.parentNode?.insertBefore(core, script.nextSibling)
}

bootstrap()
