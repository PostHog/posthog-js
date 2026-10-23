import { isFunction, isObject, isString } from '@posthog/core'
import { document } from '@posthog/browser-common/utils/globals'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { getQueryParam } from '@posthog/browser-common/utils/request-utils'
import type { PostHogConfig } from '@posthog/types'
import { assignableWindow } from '../utils/globals'

const logger = createLogger('[Loader]')

type QueuedCall = [string, ...unknown[]]

function load(): void {
    const script = document?.currentScript
    if (!document || !script || !('src' in script) || !script.src) {
        return
    }

    if (assignableWindow.posthog?.__SV || isFunction(assignableWindow.posthog?.init)) {
        return
    }

    // Putting the token in the URL path would require additional routing; a query keeps this file shared.
    const token = (getQueryParam(script.src, 'project_token') || script.getAttribute('data-project-token'))?.trim()
    if (!token) {
        logger.error('Missing project_token or data-project-token')
        return
    }

    let config: Partial<PostHogConfig> = {}
    try {
        const parsed: unknown = JSON.parse(script.getAttribute('data-config') || '{}')
        if (!isObject(parsed)) {
            logger.error('data-config must be a JSON object')
            return
        }
        config = parsed
    } catch {
        logger.error('data-config must be valid JSON')
        return
    }

    const url = document.createElement('a')
    url.href = script.src
    const origin = url.protocol + '//' + url.host
    // Explicit data-api-host and data-defaults attributes take precedence over their data-config values.
    const apiHost =
        script.getAttribute('data-api-host') ||
        config.api_host ||
        (/^https:\/\/(us|eu)-assets\.i\.posthog\.com$/.test(origin) ? origin.replace('-assets', '') : undefined)
    if (!isString(apiHost) || !apiHost.trim()) {
        logger.error('Set data-api-host when using a custom asset host')
        return
    }

    config = {
        ...config,
        api_host: apiHost,
        // Keep this snapshot fixed across loader upgrades; opt into newer behavior with data-defaults.
        defaults:
            (script.getAttribute('data-defaults') as PostHogConfig['defaults']) || config.defaults || '2026-08-30',
    }

    const posthog = Object.assign([] as QueuedCall[], {
        __SV: 1,
        _i: [[token, config, 'posthog']],
        people: [] as QueuedCall[],
    })
    const methods =
        'init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug'
    for (const method of methods.split(' ')) {
        Object.defineProperty(posthog, method, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: (...args: unknown[]) => {
                posthog.push([method, ...args])
            },
        })
    }
    Object.defineProperty(posthog, 'toString', { value: () => 'posthog (stub)', configurable: true })
    Object.defineProperty(posthog.people, 'toString', { value: () => 'posthog.people (stub)', configurable: true })
    assignableWindow.posthog = posthog

    url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1) + 'array.js'
    url.search = ''
    url.hash = ''
    const core = document.createElement('script')
    core.src = url.href
    core.async = true
    core.crossOrigin = 'anonymous'
    core.nonce = script.nonce
    core.onerror = () => logger.error('Failed to load the PostHog SDK')
    script.parentNode?.insertBefore(core, script.nextSibling)
}

load()
