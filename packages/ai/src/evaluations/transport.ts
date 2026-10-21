/// <reference lib="dom" />
import { EvaluationAPIError } from './errors'
import { decode, integer, object, text, type WireObject } from './serialization'

export interface RequestOptions {
    signal?: AbortSignal
}
export interface OfflineEvaluationsOptions {
    projectId: number
    secretKey: string
    host?: string
    /** Per-attempt timeout, including reading the response body. Default: 15,000 ms. */
    timeoutMs?: number
    /** Additional attempts for operations with safe replay identity. Default: 3. */
    maxRetries?: number
}
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const HOSTS: Record<string, string> = {
    'app.posthog.com': 'us.posthog.com',
    'us.i.posthog.com': 'us.posthog.com',
    'eu.i.posthog.com': 'eu.posthog.com',
}
export function normalizeHost(host: string): string {
    const url = new URL(text(host))
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        host.includes('?') ||
        host.includes('#')
    ) {
        throw new TypeError('Host must be an absolute HTTP(S) URL without credentials, query, or fragment.')
    }
    if (url.protocol === 'https:' && !url.port && Object.hasOwn(HOSTS, url.hostname)) url.hostname = HOSTS[url.hostname]
    return url.href.replace(/\/+$/, '')
}
function retryAfter(value: string | null): number | undefined {
    if (!value?.trim()) return undefined
    const number = Number(value)
    const seconds = Number.isFinite(number) ? number : (Date.parse(value) - Date.now()) / 1000
    return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
        const onAbort = (): void => {
            clearTimeout(timer)
            signal.removeEventListener('abort', onAbort)
            reject(signal.reason)
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        signal.addEventListener('abort', onAbort, { once: true })
    })
}

export class Transport {
    readonly projectId: number
    readonly #host: string
    readonly #secret: string
    readonly #timeout: number
    readonly #retries: number
    readonly #closed = new AbortController()
    constructor(options: OfflineEvaluationsOptions) {
        this.projectId = integer(options.projectId)
        this.#secret = text(options.secretKey)
        if (!this.#secret || /\s/.test(this.#secret))
            throw new TypeError('Secret key must be nonempty and contain no whitespace.')
        this.#host = normalizeHost(options.host ?? 'https://us.posthog.com')
        this.#timeout = options.timeoutMs === undefined ? 15000 : options.timeoutMs
        if (
            typeof this.#timeout !== 'number' ||
            !Number.isFinite(this.#timeout) ||
            this.#timeout <= 0 ||
            this.#timeout > 2147483647
        )
            throw new TypeError('Invalid timeoutMs.')
        this.#retries = integer(options.maxRetries === undefined ? 3 : options.maxRetries, 0)
    }
    close(): void {
        this.#closed.abort(new EvaluationAPIError({ code: 'client_closed' }))
    }
    async request(
        method: string,
        path: string,
        request: RequestOptions & { body?: string; params?: WireObject; retrySafe?: boolean } = {}
    ): Promise<WireObject> {
        const options = { ...request, params: request.params === undefined ? undefined : { ...request.params } }
        if (this.#closed.signal.aborted)
            throw new EvaluationAPIError({ code: 'client_closed', persistence: 'not_sent' })
        options.signal?.throwIfAborted()
        if (!path.startsWith('/') || path.startsWith('//') || /[?#]/.test(path))
            throw new TypeError('Invalid API path.')
        const url = new URL(this.#host + path)
        for (const [key, value] of Object.entries(options.params ?? {})) url.searchParams.set(key, String(value))
        const operation = new AbortController()
        const forward = (signal: AbortSignal): void => operation.abort(signal.reason)
        const externalAbort = (): void => forward(options.signal!)
        const closeAbort = (): void => forward(this.#closed.signal)
        options.signal?.addEventListener('abort', externalAbort, { once: true })
        this.#closed.signal.addEventListener('abort', closeAbort, { once: true })
        let hadUnknown = false
        try {
            for (let attempt = 0; ; attempt++) {
                operation.signal.throwIfAborted()
                const controller = new AbortController()
                const abort = (): void => controller.abort(operation.signal.reason)
                operation.signal.addEventListener('abort', abort, { once: true })
                const timer = setTimeout(() => controller.abort(), this.#timeout)
                let error: EvaluationAPIError
                try {
                    const response = await fetch(url, {
                        method,
                        body: options.body,
                        redirect: 'manual',
                        signal: controller.signal,
                        headers: {
                            Authorization: `Bearer ${this.#secret}`,
                            Accept: 'application/json',
                            'Content-Type': 'application/json',
                        },
                    })
                    const raw = await response.text()
                    operation.signal.throwIfAborted()
                    let payload: unknown
                    try {
                        payload = decode(raw)
                    } catch {
                        payload = undefined
                    }
                    if (response.ok) {
                        try {
                            return object(payload)
                        } catch {
                            throw new EvaluationAPIError({ status: response.status, code: 'invalid_response' })
                        }
                    }
                    let fields: WireObject = {}
                    try {
                        fields = object(payload)
                    } catch {
                        /* A non-object error body is retained as detail. */
                    }
                    throw new EvaluationAPIError({
                        status: response.status,
                        code: typeof fields.code === 'string' ? fields.code : undefined,
                        detail: fields.detail ?? payload,
                        attr: typeof fields.attr === 'string' ? fields.attr : undefined,
                        errors: fields.errors,
                        response: Object.keys(fields).length ? fields : undefined,
                        retryAfter: retryAfter(response.headers.get('Retry-After')),
                        persistence:
                            response.status >= 400 && response.status < 500 && response.status !== 408
                                ? 'rejected'
                                : 'unknown',
                    })
                } catch (caught) {
                    operation.signal.throwIfAborted()
                    error =
                        caught instanceof EvaluationAPIError
                            ? caught
                            : new EvaluationAPIError({ code: 'transport_error' })
                } finally {
                    clearTimeout(timer)
                    operation.signal.removeEventListener('abort', abort)
                }
                hadUnknown ||= error.persistence === 'unknown'
                if (hadUnknown) error.persistence = 'unknown'
                if (
                    !(options.retrySafe ?? method === 'GET') ||
                    attempt >= this.#retries ||
                    error.code === 'invalid_response' ||
                    (error.status !== undefined && !RETRY_STATUSES.has(error.status)) ||
                    (error.retryAfter ?? 0) > 30
                )
                    throw error
                const backoff = Math.min(30, 0.5 * 2 ** Math.min(attempt, 6) * (0.8 + Math.random() * 0.4))
                await delay(Math.max(backoff, error.retryAfter ?? 0) * 1000, operation.signal)
            }
        } finally {
            options.signal?.removeEventListener('abort', externalAbort)
            this.#closed.signal.removeEventListener('abort', closeAbort)
        }
    }
}

/** One handle's operations are atomic with respect to each other, including all bulk chunks. */
export class OperationQueue {
    #tail: Promise<void> = Promise.resolve()
    async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        signal?.throwIfAborted()
        const previous = this.#tail
        let release!: () => void
        const done = new Promise<void>((resolve) => {
            release = resolve
        })
        this.#tail = previous.then(() => done)
        let abort: (() => void) | undefined
        try {
            if (signal) {
                await Promise.race([
                    previous,
                    new Promise<never>((_, reject) => {
                        abort = () => reject(signal.reason)
                        signal.addEventListener('abort', abort, { once: true })
                    }),
                ])
                signal.throwIfAborted()
            } else await previous
            return await operation()
        } finally {
            if (abort) signal!.removeEventListener('abort', abort)
            release()
        }
    }
}
