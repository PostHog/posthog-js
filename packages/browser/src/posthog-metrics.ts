import Config from './config'
import { PostHog } from './posthog-core'
import type { CaptureMetricOptions, OtlpMetricsPayload } from './types'
import { PostHogMetrics as CorePostHogMetrics, resolveMetricsConfig } from '@posthog/core'
import type { SendMetricsBatchOutcome } from '@posthog/core'
import { createLogger } from './utils/logger'
import { Extension } from './extensions/types'

const METRICS_ENDPOINT = '/i/v1/metrics'
// Safety backstop for a `_send_request` that never calls back — same policy
// as logs: above the request layer's own 60s timeout so a real request
// always settles via its callback first.
const METRICS_SEND_TIMEOUT_MS = 90000

/**
 * The `posthog.metrics` extension: a statsd-style pre-aggregating client.
 *
 * ```ts
 * posthog.metrics.count('orders_created', 1)
 * posthog.metrics.gauge('active_connections', 42)
 * posthog.metrics.histogram('api_latency', 187, { unit: 'ms' })
 * ```
 *
 * Aggregation, series identity, and flush policy live in core's
 * `PostHogMetrics`; this wrapper adapts it to the browser request layer.
 */
export class PostHogMetrics implements Extension {
    private readonly _logger = createLogger('[metrics]')

    private _core: CorePostHogMetrics | undefined
    // The `metrics` config the current `_core` was built from; a change rebuilds it.
    private _resolvedFrom: PostHog['config']['metrics']

    constructor(private readonly _instance: PostHog) {}

    // Nothing to set up eagerly — the aggregator builds lazily on the first
    // capture so it sees post-init config. Present so the class satisfies the
    // weakly-typed `Extension` contract.
    initialize(): void {}

    // The extension is constructed before `init` applies config, so build the
    // core lazily and rebuild when `config.metrics` is swapped (e.g. via
    // `set_config`). A rebuild drops the old core's pending window — acceptable
    // for a config swap, which is rare and usually happens at startup.
    private _getCore(): CorePostHogMetrics {
        const metricsConfig = this._instance?.config?.metrics
        if (!this._core || this._resolvedFrom !== metricsConfig) {
            this._core?.reset()
            this._resolvedFrom = metricsConfig
            this._core = new CorePostHogMetrics(this._createHost(), resolveMetricsConfig(metricsConfig), this._logger)
        }
        return this._core
    }

    /** Add to a counter — things that only go up. Value defaults to 1. */
    count(name: string, value: number = 1, options?: CaptureMetricOptions): void {
        this._getCore().count(name, value, options)
    }

    /** Record the current value of something that goes up and down. */
    gauge(name: string, value: number, options?: CaptureMetricOptions): void {
        this._getCore().gauge(name, value, options)
    }

    /** Record one observation of a distribution (latency, payload size). */
    histogram(name: string, value: number, options?: CaptureMetricOptions): void {
        this._getCore().histogram(name, value, options)
    }

    /**
     * Sends the aggregated window now. With a transport, the window is
     * drained synchronously — bypassing the flush serializer, which could be
     * awaiting an in-flight send that will never finish during unload — and
     * the payload is handed to that transport in the same tick, so the
     * pagehide `sendBeacon` drain survives the page going away. A drained
     * window is not retried; the page is gone either way.
     */
    flush(transport?: 'XHR' | 'fetch' | 'sendBeacon'): Promise<void> {
        if (!this._core) {
            return Promise.resolve()
        }
        if (transport) {
            const payload = this._core.drainWindow()
            if (payload) {
                void this._sendMetricsBatch(payload, transport)
            }

            return Promise.resolve()
        }
        return this._core.flush().catch((err) => this._logger.error('PostHog metrics flush failed:', err))
    }

    reset(): void {
        this._core?.reset()
    }

    // Host adapter for core's `PostHogMetrics`; structurally checked against
    // `MetricsHost` at the `new CorePostHogMetrics` call.
    private _createHost() {
        const ph = this._instance
        const self = this
        return {
            get isDisabled() {
                return false
            },
            // The browser gates capture through `is_capturing()`.
            get optedOut() {
                return !ph.is_capturing()
            },
            _sendMetricsBatch: (payload: OtlpMetricsPayload) => self._sendMetricsBatch(payload),
            getLibraryId: () => Config.LIB_NAME,
            getLibraryVersion: () => Config.LIB_VERSION,
        }
    }

    private _sendMetricsBatch(
        payload: OtlpMetricsPayload,
        transport?: 'XHR' | 'fetch' | 'sendBeacon'
    ): Promise<SendMetricsBatchOutcome> {
        // eslint-disable-next-line compat/compat
        return new Promise((resolve) => {
            let settled = false
            const settle = (outcome: SendMetricsBatchOutcome): void => {
                if (settled) {
                    return
                }
                settled = true
                clearTimeout(timer)
                resolve(outcome)
            }

            // Backstop for `_send_request` paths that never call back, so the
            // promise always settles and core's flush can't wedge.
            const timer = setTimeout(
                () => settle({ kind: 'retry-later', error: new Error('metrics request timed out') }),
                METRICS_SEND_TIMEOUT_MS
            )

            this._instance._send_request({
                method: 'POST',
                url: this._metricsUrl(),
                data: payload,
                compression: 'best-available',
                batchKey: 'metrics',
                ...(transport && { transport }),
                // Notify on the drop paths (not loaded, rate limited) so they retry, not stall.
                fireCallbackOnDrop: true,
                callback: (response) => {
                    const status = response.statusCode
                    if (status >= 200 && status < 300) {
                        settle({ kind: 'ok' })
                    } else if (status === 413) {
                        settle({ kind: 'too-large' })
                    } else if (status === 0 || status === 429 || status >= 500) {
                        // Transient (network / rate-limit / server error): keep and retry.
                        settle({
                            kind: 'retry-later',
                            error: response.error ?? new Error(`metrics request failed with status ${status}`),
                        })
                    } else {
                        // Client error (4xx): won't succeed on retry, drop.
                        settle({ kind: 'fatal', error: new Error(`metrics request failed with status ${status}`) })
                    }
                },
            })
        })
    }

    private _metricsUrl(): string {
        return (
            this._instance.requestRouter.endpointFor('api', METRICS_ENDPOINT) +
            '?token=' +
            encodeURIComponent(this._instance.config.token)
        )
    }
}
