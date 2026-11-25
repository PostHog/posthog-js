import { RetriableRequestWithOptions } from './types'

import { isArray, isNumber, isObject, isPositiveNumber, isString, isUndefined } from '@posthog/core'
import { logger } from '@posthog/browser-common/utils/logger'
import { window } from '@posthog/browser-common/utils/globals'
import type { PostHog } from './posthog-core'
import { sendRequest } from './request-dispatch'
import { extendURLParams, removeURLParam } from './request'
import { COOKIELESS_ALWAYS } from './constants'
import { isReloadPageSwap } from './sessionid'
import { sessionStore, setSessionStorageItem } from './storage'
import { addEventListener } from '@posthog/browser-common/utils/general-utils'

const thirtyMinutes = 30 * 60 * 1000
const MAX_REPLAY_HANDOFF_CHARS = 256 * 1024
const DEFAULT_MAX_RETRIES = 10
// NOTE: posthog-logs.ts mirrors this budget with its own `MAX_CONSECUTIVE_STATUS_ZERO_FAILURES`.
// Keep the constant value and the warning copy in sync.
const STATUS_CODE_ZERO_MAX_RETRIES = 3

/**
 * Generates a jitter-ed exponential backoff delay in milliseconds
 *
 * The base value is 6 seconds, which is doubled with each retry
 * up to the maximum of 30 minutes
 *
 * Each value then has +/- 50% jitter
 *
 * Giving a range of 6 seconds up to 45 minutes
 */
export function pickNextRetryDelay(retriesPerformedSoFar: number): number {
    const rawBackoffTime = 3000 * 2 ** retriesPerformedSoFar
    const minBackoff = rawBackoffTime / 2
    const cappedBackoffTime = Math.min(thirtyMinutes, rawBackoffTime)
    const jitterFraction = Math.random() - 0.5 // A random number between -0.5 and 0.5
    const jitter = jitterFraction * (cappedBackoffTime - minBackoff)
    return Math.ceil(cappedBackoffTime + jitter)
}

interface RetryQueueElement {
    retryAt: number
    requestOptions: RetriableRequestWithOptions
}

export class RetryQueue {
    private _isPolling: boolean = false
    private _poller: number | undefined
    private _pollIntervalMs: number = 3000
    private _queue: RetryQueueElement[] = []
    private _areWeOnline: boolean
    private _onlineListener: (() => void) | undefined
    private _offlineListener: (() => void) | undefined

    private _checkedReplayHandoff = false
    private _replayGeneration = 0

    private get _replayHandoffKey(): string {
        const { token, persistence_name } = this._instance.config
        return 'ph_replay_retry_' + JSON.stringify([token, persistence_name || token])
    }

    private _canHandOffReplay(): boolean {
        const { config, consent, persistence } = this._instance
        return (
            config.persistence !== 'memory' &&
            persistence?._disabled === false &&
            !consent.isOptedOut() &&
            !config.disable_session_recording &&
            !config.before_send &&
            !config.session_recording?.selectMaskingFn
        )
    }

    // pageswap precedes pagehide and distinguishes a confirmed reload from a tab close.
    // Only remove a batch from the beacon path once its same-tab handoff succeeds.
    private _onPageSwap = (event: Event): void => {
        if (!isReloadPageSwap(event) || !this._queue.length || !this._canHandOffReplay()) {
            return
        }
        const session = this._instance.sessionManager?.peekSessionAndWindowId()
        if (!session) return
        const distinctId = this._instance.get_distinct_id()
        for (let i = 0; i < this._queue.length; i++) {
            const { retryAt, requestOptions } = this._queue[i]
            const { batchKey, batchGroup, url, data, retriesPerformedSoFar, callback } = requestOptions
            if (batchKey !== 'recordings' || !batchGroup || !isArray(data) || !data.length || callback) {
                continue
            }
            if (
                !data.every(
                    (item) =>
                        item.properties?.distinct_id === distinctId &&
                        item.properties?.$session_id === session.sessionId &&
                        item.properties?.$window_id === session.windowId
                )
            ) {
                continue
            }
            // Bound retained replay independently of the origin's storage quota.
            if (
                setSessionStorageItem(
                    this._replayHandoffKey,
                    {
                        batchGroup,
                        url: removeURLParam(url, 'retry_count'),
                        data,
                        retriesPerformedSoFar,
                        retryAt,
                        savedAt: Date.now(),
                    },
                    MAX_REPLAY_HANDOFF_CHARS
                )
            ) {
                this._queue.splice(i, 1)
            }
            // Later batches can depend on a full snapshot in this batch.
            return
        }
    }

    clearReplayRetries(): void {
        this._replayGeneration++
        this._queue = this._queue.filter(({ requestOptions }) => requestOptions.batchKey !== 'recordings')
        this.clearStoredReplayHandoff()
    }

    clearStoredReplayHandoff(): void {
        if (this._instance.config.cookieless_mode !== COOKIELESS_ALWAYS) {
            sessionStore._remove(this._replayHandoffKey)
        }
    }

    private _restoreReplayHandoff(options: RetriableRequestWithOptions): void {
        this._checkedReplayHandoff = true
        if (!this._canHandOffReplay()) {
            this.clearStoredReplayHandoff()
            return
        }
        const saved = sessionStore._parse(this._replayHandoffKey)
        if (!saved) {
            return
        }
        this.clearStoredReplayHandoff()
        if (
            !options.batchGroup ||
            saved.batchGroup !== options.batchGroup ||
            saved.url !== options.url ||
            !isNumber(saved.savedAt) ||
            Date.now() - saved.savedAt > thirtyMinutes ||
            !isNumber(saved.retryAt) ||
            !isNumber(saved.retriesPerformedSoFar) ||
            saved.retriesPerformedSoFar < 1 ||
            saved.retriesPerformedSoFar > DEFAULT_MAX_RETRIES ||
            !isArray(options.data) ||
            !isArray(saved.data) ||
            !saved.data.length
        ) {
            return
        }
        const current = options.data[0]?.properties
        if (
            !current ||
            !saved.data.every(
                (item: unknown) =>
                    isObject(item) &&
                    item.event === '$snapshot' &&
                    isString(item.uuid) &&
                    item.properties?.token === current.token &&
                    item.properties?.distinct_id === current.distinct_id &&
                    item.properties?.$session_id === current.$session_id &&
                    item.properties?.$window_id === current.$window_id
            )
        ) {
            return
        }
        // Reuse only the live recorder's transport configuration. Storage cannot supply an endpoint or headers.
        this._queue.push({
            retryAt: saved.retryAt,
            requestOptions: {
                ...options,
                callback: undefined,
                data: saved.data,
                retriesPerformedSoFar: saved.retriesPerformedSoFar,
            },
        })
        this._ensurePolling()
    }

    constructor(private _instance: PostHog) {
        this._queue = []
        this._areWeOnline = true
        const { config, consent } = this._instance
        if (
            consent.isOptedOut() ||
            config.disable_persistence ||
            config.before_send ||
            config.session_recording?.selectMaskingFn
        ) {
            this.clearStoredReplayHandoff()
        } else if (config.cookieless_mode !== COOKIELESS_ALWAYS && config.persistence !== 'memory') {
            const saved = sessionStore._parse(this._replayHandoffKey)
            if (isNumber(saved?.savedAt) && Date.now() - saved.savedAt > thirtyMinutes) {
                this.clearStoredReplayHandoff()
            }
        }
        this.resume()
    }

    resume(): void {
        if (!isUndefined(window) && 'onLine' in window.navigator) {
            this._areWeOnline = window.navigator.onLine

            if (this._onlineListener) {
                return
            }

            this._onlineListener = () => {
                this._areWeOnline = true
                this._flush()
            }

            this._offlineListener = () => {
                this._areWeOnline = false
            }

            addEventListener(window, 'pageswap', this._onPageSwap)
            addEventListener(window, 'online', this._onlineListener)
            addEventListener(window, 'offline', this._offlineListener)
        }
    }

    get length() {
        return this._queue.length
    }

    retriableRequest(
        { retriesPerformedSoFar, ...options }: RetriableRequestWithOptions,
        transportOverride?: RetriableRequestWithOptions['transport']
    ): void {
        if (!this._checkedReplayHandoff && options.batchKey === 'recordings' && !transportOverride) {
            this._restoreReplayHandoff(options)
        }
        if (isPositiveNumber(retriesPerformedSoFar)) {
            options.url = extendURLParams(options.url, { retry_count: retriesPerformedSoFar })
        }

        const replayGeneration = this._replayGeneration
        sendRequest(
            this._instance,
            transportOverride ? { ...options, transport: transportOverride } : options,
            (response, retryAfterMs) => {
                if (options.batchKey === 'recordings' && replayGeneration !== this._replayGeneration) {
                    return
                }
                if (response.statusCode !== 200 && (response.statusCode < 400 || response.statusCode >= 500)) {
                    const maxRetries = response.statusCode === 0 ? STATUS_CODE_ZERO_MAX_RETRIES : DEFAULT_MAX_RETRIES

                    if ((retriesPerformedSoFar ?? 0) < maxRetries) {
                        this._enqueue(
                            {
                                retriesPerformedSoFar,
                                ...options,
                            },
                            retryAfterMs
                        )
                        return
                    }

                    if (response.statusCode === 0) {
                        logger.warn(
                            `Request failed before receiving an HTTP response; this can happen due to network issues, CORS, browser blocking, or ad blockers. Stopped retrying after ${retriesPerformedSoFar ?? 0} retries.`
                        )
                    }
                }

                options.callback?.(response)
            }
        )
    }

    private _enqueue(requestOptions: RetriableRequestWithOptions, retryAfterMs?: number): void {
        const retriesPerformedSoFar = requestOptions.retriesPerformedSoFar || 0
        requestOptions.retriesPerformedSoFar = retriesPerformedSoFar + 1

        const msToNextRetry = Math.max(pickNextRetryDelay(retriesPerformedSoFar), retryAfterMs ?? 0)
        const retryAt = Date.now() + msToNextRetry

        this._queue.push({ retryAt, requestOptions })

        let logMessage = `Enqueued failed request for retry in ${msToNextRetry}`
        if (!navigator.onLine) {
            logMessage += ' (Browser is offline)'
        }
        logger.warn(logMessage)

        this._ensurePolling()
    }

    private _ensurePolling(): void {
        if (!this._isPolling) {
            this._isPolling = true
            this._poll()
        }
    }

    private _poll(): void {
        this._poller && clearTimeout(this._poller)

        if (this._queue.length === 0) {
            this._isPolling = false
            this._poller = undefined
            return
        }

        this._poller = setTimeout(() => {
            if (this._areWeOnline && this._queue.length > 0) {
                this._flush()
            }
            this._poll()
        }, this._pollIntervalMs) as any as number
    }

    private _flush(): void {
        const now = Date.now()
        const notToFlush: RetryQueueElement[] = []
        const toFlush = this._queue.filter((item) => {
            if (item.retryAt < now) {
                return true
            }
            notToFlush.push(item)
            return false
        })

        this._queue = notToFlush

        if (toFlush.length > 0) {
            for (const { requestOptions } of toFlush) {
                this.retriableRequest(requestOptions)
            }
        }
    }

    unload(): void {
        if (this._poller) {
            clearTimeout(this._poller)
            this._poller = undefined
        }

        this._isPolling = false

        if (!isUndefined(window)) {
            window.removeEventListener('pageswap', this._onPageSwap)
            if (this._onlineListener) {
                window.removeEventListener('online', this._onlineListener)
                this._onlineListener = undefined
            }
            if (this._offlineListener) {
                window.removeEventListener('offline', this._offlineListener)
                this._offlineListener = undefined
            }
        }

        for (const { requestOptions } of this._queue) {
            try {
                // we've had send beacon in place for at least 2 years
                this._instance._send_request({
                    ...requestOptions,
                    // Split beacon fallbacks cannot acknowledge delivery of the entire batch.
                    callback: isArray(requestOptions.data) ? undefined : requestOptions.callback,
                    transport: 'sendBeacon',
                })
            } catch (e) {
                // Note sendBeacon automatically retries, and after the first retry it will lose reference to contextual `this`.
                // This means in some cases `this.getConfig` will be undefined.
                logger.error(e)
            }
        }
        this._queue = []
    }
}
