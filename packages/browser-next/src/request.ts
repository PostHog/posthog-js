import type { ApiResponse, RequestTarget, SendRequestInit } from '@posthog/browser-common'

import type { BrowserFetch, BrowserNavigator } from './types'

export const createFailedResponse = (error?: unknown): ApiResponse => ({
    statusCode: 0,
    error,
})

const toApiResponse = async (response: Response): Promise<ApiResponse> => {
    const text = await response.text()
    let json: unknown

    if (text) {
        try {
            json = JSON.parse(text)
        } catch {
            // The response was not JSON.
        }
    }

    return {
        statusCode: response.status,
        ...(text ? { text } : {}),
        ...(json !== undefined ? { json } : {}),
    }
}

export type RequestRuntime = [
    hosts: Record<RequestTarget, string>,
    projectToken: string,
    fetch: BrowserFetch | undefined,
    navigator: BrowserNavigator | undefined,
]

export const sendRequest = async (
    runtime: RequestRuntime,
    path: string,
    init: SendRequestInit = {},
    canContinue: () => boolean = () => true
): Promise<ApiResponse> => {
    let url: URL
    let body: string | undefined
    let method: string
    let headers: Record<string, string>

    try {
        if (!path.startsWith('/') || path.startsWith('//')) {
            return createFailedResponse(new Error('Request paths must be relative to a configured PostHog host'))
        }

        const baseUrl = new URL(`${runtime[0][init.target ?? 'api']}/`)
        url = new URL(path, baseUrl)
        if (url.origin !== baseUrl.origin) {
            return createFailedResponse(new Error('Request path resolved outside the configured PostHog host'))
        }
        for (const [key, value] of Object.entries(init.query ?? {})) {
            url.searchParams.set(key, value)
        }
        // Extensions cannot replace the host client's authentication token.
        url.searchParams.set('token', runtime[1])
        body = init.body === undefined ? undefined : JSON.stringify(init.body)
        method = init.method ?? (body === undefined ? 'GET' : 'POST')
        headers = { ...init.headers }
    } catch (error) {
        return createFailedResponse(error)
    }

    if (!canContinue()) {
        return createFailedResponse(new Error('PostHog requests are disabled'))
    }

    const navigator = runtime[3]
    let beacon: BrowserNavigator['sendBeacon']
    try {
        beacon = navigator?.sendBeacon
    } catch {
        // Fall back to Fetch.
    }
    if (init.transport === 'sendBeacon' && method === 'POST' && beacon) {
        try {
            const data =
                body === undefined || typeof Blob !== 'function' ? body : new Blob([body], { type: 'application/json' })
            if (!canContinue()) {
                return createFailedResponse(new Error('PostHog requests are disabled'))
            }
            if (beacon.call(navigator, url.toString(), data)) {
                return canContinue()
                    ? { statusCode: 202 }
                    : createFailedResponse(new Error('PostHog requests are disabled'))
            }
        } catch {
            // Fall back to Fetch with keepalive.
        }
    }

    const fetch = runtime[2]
    if (!fetch) {
        return createFailedResponse(new Error('Fetch is not available'))
    }

    const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : undefined
    const timeout =
        controller && init.timeoutMs ? globalThis.setTimeout(() => controller.abort(), init.timeoutMs) : undefined

    try {
        const requestInit: RequestInit = { method, credentials: 'omit', headers }
        if (body !== undefined) {
            requestInit.body = body
            headers['Content-Type'] ??= 'application/json'
        }
        if (init.transport === 'sendBeacon') {
            requestInit.keepalive = true
        }
        if (controller) {
            requestInit.signal = controller.signal
        }
        if (!canContinue()) {
            return createFailedResponse(new Error('PostHog requests are disabled'))
        }

        const response = await toApiResponse(await fetch(url, requestInit))
        return canContinue() ? response : createFailedResponse(new Error('PostHog requests are disabled'))
    } catch (error) {
        return canContinue()
            ? createFailedResponse(error)
            : createFailedResponse(new Error('PostHog requests are disabled'))
    } finally {
        if (timeout !== undefined) {
            globalThis.clearTimeout(timeout)
        }
    }
}
