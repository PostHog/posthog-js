import type { PostHogOptions } from 'posthog-node'

export type NextRequestError = Error & { digest?: string }

type HeaderValue = string | string[] | null | undefined

type HeadersLike = { get(name: string): string | null | undefined } | Record<string, HeaderValue> | undefined | null

export interface NextRequestErrorRequest {
    headers?: HeadersLike
    method?: string
    path?: string
    url?: string
}

export interface NextRequestErrorContext {
    routerKind?: string
    routePath?: string
    routeType?: string
    renderSource?: string
    revalidateReason?: string
    [key: string]: unknown
}

export interface OnRequestErrorBeforeCaptureContext {
    error: unknown
    request: NextRequestErrorRequest
    context: NextRequestErrorContext
    distinctId?: string
    properties: Record<string, unknown>
}

export interface OnRequestErrorOptions {
    /** PostHog project API key. Defaults to NEXT_PUBLIC_POSTHOG_KEY. */
    apiKey?: string
    /** PostHog host. Defaults to NEXT_PUBLIC_POSTHOG_HOST, then https://us.i.posthog.com. */
    host?: string
    /** Additional posthog-node options for the server-side client. */
    serverOptions?: Partial<PostHogOptions>
    /** Set to true to disable server-side exception capture for this handler. */
    disabled?: boolean
    /**
     * Consent options used when checking the PostHog opt-out cookie before capturing.
     * These mirror the browser SDK consent cookie options.
     */
    consent?: {
        consent_persistence_name?: string | null
        opt_out_capturing_cookie_prefix?: string | null
        opt_out_capturing_by_default?: boolean
    }
    /**
     * Seconds without activity after which the browser SDK starts a new session. A PostHog cookie session that has
     * been idle for longer is not attached to the exception. Set it to the `session_idle_timeout_seconds` you give
     * posthog-js. Like posthog-js, it is clamped to 60 seconds to 10 hours. Default: 1800 (30 minutes).
     */
    sessionIdleTimeoutSeconds?: number
    /**
     * Optionally add or override properties before capture. Return false to skip capture.
     */
    beforeCapture?: (
        captureContext: OnRequestErrorBeforeCaptureContext
    ) => Record<string, unknown> | false | void | Promise<Record<string, unknown> | false | void>
}

export type NextOnRequestError = (
    error: unknown,
    request: NextRequestErrorRequest,
    context: NextRequestErrorContext
) => void | Promise<void>
