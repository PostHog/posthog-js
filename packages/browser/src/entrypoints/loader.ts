import { isFunction, isObject, isString } from '@posthog/core'
import { document } from '@posthog/browser-common/utils/globals'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { getQueryParam } from '@posthog/browser-common/utils/request-utils'
import type { PostHogConfig } from '@posthog/types'
import { assignableWindow } from '../utils/globals'
import { createPostHogStub, QueuedInit } from '../utils/loader-stub'
import { getSDKScriptURL } from '../utils/loader-script'

const logger = createLogger('[Loader]')

function getAutoInit(script: HTMLScriptElement, origin: string): QueuedInit | undefined {
    // Putting the token in the URL path would require additional routing; a query keeps this file shared.
    const token = (getQueryParam(script.src, 'project_token') || script.getAttribute('data-project-token'))?.trim()
    if (!token) {
        logger.critical('Missing project_token or data-project-token')
        return
    }

    let config: Partial<PostHogConfig> = {}
    try {
        const parsed: unknown = JSON.parse(script.getAttribute('data-config') || '{}')
        if (!isObject(parsed)) {
            logger.critical('data-config must be a JSON object')
            return
        }
        config = parsed
    } catch {
        logger.critical('data-config must be valid JSON')
        return
    }

    // Explicit data-api-host and data-defaults attributes take precedence over their data-config values.
    const apiHost =
        script.getAttribute('data-api-host') ||
        config.api_host ||
        (/^https:\/\/(us|eu)-assets\.i\.posthog\.com$/.test(origin) ? origin.replace('-assets', '') : undefined)
    if (!isString(apiHost) || !apiHost.trim()) {
        logger.critical('Set data-api-host when using a custom asset host')
        return
    }

    config = { ...config, api_host: apiHost }
    const defaults = script.getAttribute('data-defaults')
    if (defaults) {
        config.defaults = defaults as PostHogConfig['defaults']
    }
    return [token, config, 'posthog']
}

function load(): void {
    const script = document?.currentScript
    if (!document || !script || !('src' in script) || !script.src) {
        return
    }
    if (assignableWindow.posthog?.__SV || isFunction(assignableWindow.posthog?.init)) {
        return
    }

    const url = document.createElement('a')
    url.href = script.src
    const deferInit = script.getAttribute('data-defer-init') === 'true'
    // Deferred mode leaves token and configuration entirely to the explicit init() call.
    const initialization = deferInit ? undefined : getAutoInit(script, url.protocol + '//' + url.host)
    if (!deferInit && !initialization) {
        return
    }
    assignableWindow.posthog = createPostHogStub(initialization)

    const core = document.createElement('script')
    core.src = getSDKScriptURL(url)
    core.async = true
    core.crossOrigin = 'anonymous'
    core.nonce = script.nonce
    core.onerror = () => logger.error('Failed to load the PostHog SDK')
    script.parentNode?.insertBefore(core, script.nextSibling)
}

load()
