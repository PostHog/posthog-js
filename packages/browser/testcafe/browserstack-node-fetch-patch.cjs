'use strict'

const Module = require('module')

const BROWSERSTACK_HOSTS = new Set(['api.browserstack.com', 'hub-cloud.browserstack.com'])
const DEFAULT_MAX_ATTEMPTS = 4
const DEFAULT_BACKOFF_MS = [1000, 3000, 7000]
const RETRYABLE_BROWSERSTACK_PAYLOAD_STATUSES = new Set([13])
const SESSION_URL_PATH = /^\/wd\/hub\/session\/[^/]+\/url$/
const originalLoad = Module._load

function getMaxAttempts() {
    const configured = Number(process.env.BROWSERSTACK_API_MAX_ATTEMPTS)
    return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_ATTEMPTS
}

function getBackoffMs(attempt) {
    const configured = process.env.BROWSERSTACK_API_BACKOFF_MS
    const parsed = configured
        ? configured
              .split(',')
              .map((value) => Number(value.trim()))
              .filter((value) => Number.isFinite(value) && value >= 0)
        : []
    const values = parsed.length > 0 ? parsed : DEFAULT_BACKOFF_MS

    return values[Math.min(attempt - 1, values.length - 1)] || 0
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function getTarget(url) {
    const target = typeof url === 'string' ? url : url && (url.url || url.href)

    if (!target) {
        return null
    }

    try {
        return new URL(target)
    } catch (_) {
        return null
    }
}

function isBrowserStackRequest(url) {
    const target = getTarget(url)
    return !!target && BROWSERSTACK_HOSTS.has(target.hostname)
}

function isSetupRequest(url, options = {}) {
    const target = getTarget(url)

    if (!target || !BROWSERSTACK_HOSTS.has(target.hostname)) {
        return false
    }

    if (
        target.pathname === '/automate/browsers.json' ||
        /^\/automate\/sessions\/[^/]+\.json$/.test(target.pathname)
    ) {
        return true
    }

    return (
        getMethod(options) === 'POST' &&
        (target.pathname === '/wd/hub/session' || SESSION_URL_PATH.test(target.pathname))
    )
}

function getMethod(options = {}) {
    return (options.method || 'GET').toUpperCase()
}

function getRequestDescription(url, options = {}) {
    const target = getTarget(url)
    const method = getMethod(options)
    return target ? `${method} ${target.origin}${target.pathname}` : `${method} ${String(url)}`
}

function withIdentityEncoding(fetch, headers) {
    if (headers?.set) {
        const nextHeaders = new fetch.Headers(headers)
        nextHeaders.set('Accept-Encoding', 'identity')
        return nextHeaders
    }

    return {
        ...headers,
        'Accept-Encoding': 'identity',
    }
}

function isRetryableStatus(status) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
}

function isRetryableError(error) {
    const message = String(error?.message || error || '').toLowerCase()
    const code = String(error?.code || '').toUpperCase()
    const type = String(error?.type || '').toLowerCase()

    return (
        code === 'ECONNRESET' ||
        code === 'ECONNREFUSED' ||
        code === 'EPIPE' ||
        code === 'ETIMEDOUT' ||
        code === 'ERR_STREAM_PREMATURE_CLOSE' ||
        type === 'request-timeout' ||
        type === 'system' ||
        message.includes('premature close') ||
        message.includes('unexpected end') ||
        message.includes('socket hang up') ||
        message.includes('invalid response body') ||
        message.includes('response aborted') ||
        message.includes('timeout')
    )
}

function setupFailurePrefix(url, options) {
    return isSetupRequest(url, options) ? 'POSTHOG_BROWSERSTACK_SETUP_FAILURE' : 'POSTHOG_BROWSERSTACK_API_FAILURE'
}

function addBrowserStackContext(error, url, options, attempts) {
    const prefix = setupFailurePrefix(url, options)
    const description = getRequestDescription(url, options)
    const originalMessage = error?.message || String(error)
    const nextError = error instanceof Error ? error : new Error(originalMessage)

    nextError.message = `${prefix}: BrowserStack request failed after ${attempts} attempts (${description}): ${originalMessage}`
    return nextError
}

function logRetry(url, options, attempt, maxAttempts, reason) {
    const delay = getBackoffMs(attempt)
    const description = getRequestDescription(url, options)

    console.warn(
        `[browserstack-retry] ${description} failed on attempt ${attempt}/${maxAttempts}: ${reason}. Retrying in ${delay}ms.`
    )
    return delay
}

function getBrowserStackPayloadError(payload) {
    if (
        !payload ||
        typeof payload !== 'object' ||
        !payload.status ||
        !RETRYABLE_BROWSERSTACK_PAYLOAD_STATUSES.has(Number(payload.status))
    ) {
        return null
    }

    const message = payload.value?.message || payload.message || JSON.stringify(payload)
    return new Error(`BrowserStack API returned status ${payload.status}: ${message}`)
}

async function fetchBrowserStack(fetch, url, options = {}, firstAttempt = 1) {
    const maxAttempts = getMaxAttempts()

    for (let attempt = firstAttempt; attempt <= maxAttempts; attempt++) {
        try {
            const response = await fetch(url, options)

            if (isRetryableStatus(response.status) && attempt < maxAttempts) {
                if (response.body?.destroy) {
                    response.body.destroy()
                }

                await sleep(logRetry(url, options, attempt, maxAttempts, `HTTP ${response.status}`))
                continue
            }

            return wrapResponseBodyReaders(fetch, url, options, response, attempt)
        } catch (error) {
            if (!isRetryableError(error) || attempt >= maxAttempts) {
                throw addBrowserStackContext(error, url, options, attempt)
            }

            await sleep(logRetry(url, options, attempt, maxAttempts, error.message || error))
        }
    }
}

function wrapResponseBodyReaders(fetch, url, options, response, attemptsUsed) {
    for (const method of ['json', 'arrayBuffer', 'text']) {
        if (typeof response[method] !== 'function') {
            continue
        }

        const original = response[method].bind(response)

        response[method] = async () => {
            let payload

            try {
                payload = await original()
            } catch (error) {
                if (!isRetryableError(error) || attemptsUsed >= getMaxAttempts()) {
                    throw addBrowserStackContext(error, url, options, attemptsUsed)
                }

                await sleep(logRetry(url, options, attemptsUsed, getMaxAttempts(), error.message || error))
                const retryResponse = await fetchBrowserStack(fetch, url, options, attemptsUsed + 1)
                return retryResponse[method]()
            }

            const payloadError = method === 'json' && isSetupRequest(url, options) && getBrowserStackPayloadError(payload)

            if (!payloadError) {
                return payload
            }

            if (attemptsUsed >= getMaxAttempts()) {
                throw addBrowserStackContext(payloadError, url, options, attemptsUsed)
            }

            await sleep(logRetry(url, options, attemptsUsed, getMaxAttempts(), payloadError.message))
            const retryResponse = await fetchBrowserStack(fetch, url, options, attemptsUsed + 1)
            return retryResponse[method]()
        }
    }

    return response
}

function patchNodeFetch(fetch) {
    if (fetch.__posthogBrowserStackFetchPatch) {
        return fetch
    }

    const patchedFetch = (url, options = {}) => {
        if (isBrowserStackRequest(url)) {
            options = {
                ...options,
                compress: false,
                headers: withIdentityEncoding(fetch, options.headers),
            }

            return fetchBrowserStack(fetch, url, options)
        }

        return fetch(url, options)
    }

    Object.assign(patchedFetch, fetch)
    Object.defineProperty(patchedFetch, '__posthogBrowserStackFetchPatch', { value: true })

    return patchedFetch
}

if (process.env.JEST_WORKER_ID === undefined) {
    Module._load = function patchedLoad(request, parent, isMain) {
        const loadedModule = originalLoad.apply(this, arguments)

        if (request === 'node-fetch') {
            return patchNodeFetch(loadedModule)
        }

        return loadedModule
    }
}

module.exports = {
    isBrowserStackRequest,
    isRetryableError,
    isRetryableStatus,
    isSetupRequest,
    patchNodeFetch,
}
