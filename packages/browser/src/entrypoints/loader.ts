import { isFunction, isObject, isString, isUndefined } from '@posthog/core'
import { document } from '@posthog/browser-common/utils/globals'
import { createLogger } from '@posthog/browser-common/utils/logger'
import { getQueryParam } from '@posthog/browser-common/utils/request-utils'
import type { PostHogConfig } from '@posthog/types'
import { version } from '../../package.json'
import { assignableWindow } from '../utils/globals'
import methods from 'virtual:posthog-loader-methods'

const logger = createLogger('[Loader]')

type QueuedCall = [string, ...unknown[]]
type QueuedInit = [string, Partial<PostHogConfig>, string]

function createStub(instanceName = 'posthog') {
    const stub = Object.assign([] as QueuedCall[], { people: [] as QueuedCall[] })
    for (const method of methods.split(' ')) {
        const [namespace, nestedMethod] = method.split('.')
        const queue = nestedMethod ? stub.people : stub
        const name = nestedMethod || namespace
        Object.defineProperty(queue, name, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: (...args: unknown[]) => {
                queue.push([name, ...args])
            },
        })
    }
    const name = instanceName === 'posthog' ? 'posthog' : 'posthog.' + instanceName
    Object.defineProperty(stub, 'toString', { value: () => name + ' (stub)', configurable: true })
    Object.defineProperty(stub.people, 'toString', { value: () => name + '.people (stub)', configurable: true })
    return stub
}

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

    const coreIntegrity = script.getAttribute('data-core-integrity')?.trim()
    if (!isUndefined(coreIntegrity) && !/^sha384-[A-Za-z0-9+/]{64}$/.test(coreIntegrity)) {
        logger.critical('data-core-integrity must be a SHA-384 integrity hash')
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

    const posthog = Object.assign(createStub(), {
        __SV: 1,
        _i: initialization ? [initialization] : [],
    })
    Object.defineProperty(posthog, 'init', {
        value: (token: string, config: Partial<PostHogConfig> = {}, name?: string) => {
            const instanceName = name || 'posthog'
            const existing = Object.getOwnPropertyDescriptor(posthog, instanceName)?.value
            const instance = instanceName === 'posthog' ? posthog : existing || createStub(instanceName)
            if (instanceName !== 'posthog' && !existing) {
                Object.defineProperty(posthog, instanceName, {
                    value: instance,
                    configurable: true,
                    enumerable: true,
                    writable: true,
                })
            }
            posthog._i.push([token, config, instanceName])
            return instance
        },
    })
    assignableWindow.posthog = posthog

    const directory = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
    // Cached mutable loaders must keep using their own release, not a separately cached SDK alias.
    const versionedDirectory = /\/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\/$/.test(directory)
        ? directory
        : directory.replace(/\/static\/\d+\/$/, '/static/') + version + '/'
    url.pathname = versionedDirectory + 'array.js'
    url.search = ''
    url.hash = ''
    const core = document.createElement('script')
    core.src = url.href
    core.async = true
    core.crossOrigin = 'anonymous'
    if (coreIntegrity) {
        core.integrity = coreIntegrity
    }
    core.nonce = script.nonce
    core.onerror = () => logger.error('Failed to load the PostHog SDK')
    script.parentNode?.insertBefore(core, script.nextSibling)
}

load()
