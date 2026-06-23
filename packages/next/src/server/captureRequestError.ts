import { isArray, isFunction } from '@posthog/core'
import { cookieStateToProperties, cookieStoreFromHeader, isOptedOut, readPostHogCookie } from '../shared/cookie.js'
import { resolveApiKey, resolveHostOrDefault } from '../shared/config.js'
import type { NextRequestErrorContext, NextRequestErrorRequest, OnRequestErrorOptions } from './onRequestError.types.js'

interface PostHogExceptionCaptureClient {
    captureExceptionImmediate(
        error: unknown,
        distinctId?: string,
        additionalProperties?: Record<string, unknown>
    ): Promise<void>
}

type ServerOptions = NonNullable<OnRequestErrorOptions['serverOptions']>

type GetOrCreateClient = (apiKey: string, options?: ServerOptions) => Promise<PostHogExceptionCaptureClient>

type HeaderValue = string | string[] | null | undefined

type HeadersLike = NextRequestErrorRequest['headers']

export async function captureNextRequestError(
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    options: OnRequestErrorOptions,
    getOrCreateClient: GetOrCreateClient
): Promise<void> {
    if (options.disabled) {
        return
    }

    const apiKey = resolveApiKey(options.apiKey)
    if (!apiKey) {
        return
    }

    const cookieHeader = getHeader(request.headers, 'cookie')
    const cookieStore = cookieStoreFromHeader(cookieHeader ?? '')
    if (isOptedOut(cookieStore, apiKey, options.consent)) {
        return
    }

    const cookieState = readPostHogCookie(cookieStore, apiKey)
    const distinctId = cookieState?.distinctId
    let properties = buildExceptionProperties(error, request, context, cookieStateToProperties(cookieState))

    let beforeCaptureResult: Awaited<ReturnType<NonNullable<OnRequestErrorOptions['beforeCapture']>>> | undefined
    try {
        beforeCaptureResult = await options.beforeCapture?.({ error, request, context, distinctId, properties })
    } catch (captureError) {
        // eslint-disable-next-line no-console
        console.warn('[PostHog Next.js] Failed to run beforeCapture for server-side exception:', captureError)
        return
    }
    if (beforeCaptureResult === false) {
        return
    }
    if (beforeCaptureResult && typeof beforeCaptureResult === 'object') {
        properties = { ...properties, ...beforeCaptureResult }
    }

    try {
        const host = resolveHostOrDefault(options.host ?? options.serverOptions?.host)
        const client = await getOrCreateClient(apiKey, {
            ...options.serverOptions,
            host,
        })

        await client.captureExceptionImmediate(error, distinctId, properties)
    } catch (captureError) {
        // eslint-disable-next-line no-console
        console.warn('[PostHog Next.js] Failed to capture server-side exception:', captureError)
    }
}

function buildExceptionProperties(
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext,
    cookieProperties?: Record<string, string>
): Record<string, unknown> {
    const properties: Record<string, unknown> = {
        ...cookieProperties,
    }

    const method = normalizeString(request.method)
    if (method) {
        properties.$http_method = method
    }

    const path = normalizeRequestPath(request)
    if (path) {
        properties.$pathname = path
    }

    const digest = getErrorDigest(error)
    if (digest) {
        properties.nextjs_error_digest = digest
    }

    addStringProperty(properties, 'nextjs_router_kind', context.routerKind)
    addStringProperty(properties, 'nextjs_route_path', context.routePath)
    addStringProperty(properties, 'nextjs_route_type', context.routeType)
    addStringProperty(properties, 'nextjs_render_source', context.renderSource)
    addStringProperty(properties, 'nextjs_revalidate_reason', context.revalidateReason)

    return properties
}

function normalizeRequestPath(request: NextRequestErrorRequest): string | undefined {
    const explicitPath = normalizeString(request.path)
    if (explicitPath) {
        return stripSearchAndHash(explicitPath)
    }

    const url = normalizeString(request.url)
    if (!url) {
        return undefined
    }

    try {
        // eslint-disable-next-line compat/compat
        const parsed = new URL(url, 'http://localhost')
        return parsed.pathname
    } catch {
        return stripSearchAndHash(url)
    }
}

function stripSearchAndHash(value: string): string {
    return value.split(/[?#]/, 1)[0]
}

function getHeader(headers: HeadersLike, name: string): string | undefined {
    if (!headers || typeof headers !== 'object') {
        return undefined
    }

    const getter = (headers as { get?: unknown }).get
    if (isFunction(getter)) {
        return normalizeHeaderValue(getter.call(headers, name) ?? getter.call(headers, name.toLowerCase()))
    }

    const record = headers as Record<string, HeaderValue>
    return normalizeHeaderValue(record[name] ?? record[name.toLowerCase()])
}

function normalizeHeaderValue(value: HeaderValue): string | undefined {
    if (isArray(value)) {
        return value.join('; ')
    }
    return normalizeString(value)
}

function normalizeString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function addStringProperty(properties: Record<string, unknown>, key: string, value: unknown): void {
    const normalized = normalizeString(value)
    if (normalized) {
        properties[key] = normalized
    }
}

function getErrorDigest(error: unknown): string | undefined {
    if (!error || typeof error !== 'object') {
        return undefined
    }
    return normalizeString((error as { digest?: unknown }).digest)
}
