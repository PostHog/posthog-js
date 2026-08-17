import { safeSetTimeout, uuidv7 } from '@posthog/core'
import type { Logger, Metrics } from '@posthog/core'
import type { PostHogBackendClient } from '@/client'
import type { PostHogOptions } from '@/types'
import type { RuntimeMetricsSampler } from './types'
import { version } from '@/version'

/**
 * Feature flag that turns runtime metrics autocapture on when
 * `enableMetricsAutocapture` is left unset.
 */
export const METRICS_AUTOCAPTURE_FLAG = 'metrics-sdk-autocapture'

export const DEFAULT_SAMPLE_INTERVAL_MS = 10000
const MINIMUM_SAMPLE_INTERVAL_MS = 1000
/**
 * How often the gate flag is re-evaluated. Re-checking is what makes the flag a
 * kill switch rather than a boot-time-only decision: turning it off stops a
 * running fleet from collecting within one interval, without a deploy. It's
 * matched to the flag definition polling interval, and each check is a local
 * evaluation against already-cached definitions, so it costs no request.
 */
export const GATE_POLL_INTERVAL_MS = 30000

/**
 * PROOF OF CONCEPT — autocaptures low-level Node runtime metrics (CPU, memory,
 * event loop delay, GC) through the `posthog.metrics` client, with no
 * instrumentation from the user.
 *
 * Three-state gate, mirroring how a server-controlled SDK behaviour has to work
 * if the eventual goal is "install the SDK and get metrics":
 *
 * - `enableMetricsAutocapture: true` — on, no flag evaluation at all.
 * - `enableMetricsAutocapture: false` — off, no flag evaluation at all.
 * - unset — decided by the `metrics-sdk-autocapture` feature flag, re-evaluated
 *   every {@link GATE_POLL_INTERVAL_MS} so it doubles as a remote kill switch.
 *
 * The gate is evaluated **locally only**, against the flag definitions the
 * poller already caches (so it needs `secretKey`). No `/flags` request, no
 * `$feature_flag_called` event, nothing added to the user's critical path or
 * bill for a decision the SDK is making about itself. The consequence is that
 * the gate flag has to be locally evaluable — a simple rollout percentage or
 * property condition, not a cohort or experience-continuity flag.
 *
 * The flag is evaluated against a synthetic per-process distinct ID, so a
 * percentage rollout buckets *processes* rather than end users, and person
 * properties (`$lib`, `$lib_version`, `service_name`, `environment`) are passed
 * so the flag can be targeted at one service or SDK version.
 */
export default class MetricsAutocapture {
  private readonly _client: PostHogBackendClient
  private readonly _options: PostHogOptions
  private readonly _logger: Logger
  private readonly _localEvaluationEnabled: boolean
  private readonly _createSampler: () => RuntimeMetricsSampler | undefined
  private readonly _intervalMs: number

  private _sampler?: RuntimeMetricsSampler
  private _sampleTimer?: ReturnType<typeof safeSetTimeout>
  private _gateTimer?: ReturnType<typeof safeSetTimeout>
  private _gateId?: string
  private _sampling = false
  private _shutdown = false
  private _sampleErrorLogged = false

  constructor(
    client: PostHogBackendClient,
    options: PostHogOptions,
    logger: Logger,
    localEvaluationEnabled: boolean,
    createSampler: () => RuntimeMetricsSampler | undefined
  ) {
    this._client = client
    this._options = options
    this._logger = logger.createLogger('[Metrics autocapture]')
    this._localEvaluationEnabled = localEvaluationEnabled
    this._createSampler = createSampler
    this._intervalMs = Math.max(
      options.metricsAutocaptureIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
      MINIMUM_SAMPLE_INTERVAL_MS
    )
  }

  /**
   * Resolves the gate and starts sampling if it is open. Never throws and never
   * blocks: the flag evaluation runs detached so constructing a client stays
   * synchronous, and a failed evaluation just leaves autocapture off until the
   * next poll.
   */
  start(): void {
    if (this._options.enableMetricsAutocapture === false || this._client.isDisabled || this._client.optedOut) {
      return
    }

    if (this._options.enableMetricsAutocapture === true) {
      this._startSampling()
      return
    }

    if (!this._localEvaluationEnabled) {
      // Without local evaluation the gate would cost a `/flags` request per
      // poll, so it stays closed. Opt in explicitly instead.
      this._logger.debug(
        `Not evaluating ${METRICS_AUTOCAPTURE_FLAG} because local evaluation is off — ` +
          'pass `enableMetricsAutocapture: true` to collect runtime metrics without it.'
      )
      return
    }

    void this._pollGate()
  }

  /** Whether the gate is currently open and runtime metrics are being sampled. */
  isEnabled(): boolean {
    return this._sampling
  }

  shutdown(): void {
    this._shutdown = true
    if (this._gateTimer) {
      clearTimeout(this._gateTimer)
      this._gateTimer = undefined
    }
    this._stopSampling()
  }

  private async _pollGate(): Promise<void> {
    let enabled = false
    try {
      enabled = await this._evaluateGate()
    } catch (err) {
      // Evaluation is best effort — nothing here may take down the host process,
      // and the next poll gets another go once definitions have loaded.
      this._logger.debug(`Could not evaluate ${METRICS_AUTOCAPTURE_FLAG}:`, err)
    }

    if (this._shutdown) {
      return
    }

    if (enabled) {
      this._startSampling()
    } else {
      this._stopSampling()
    }

    this._gateTimer = safeSetTimeout(() => void this._pollGate(), GATE_POLL_INTERVAL_MS)
  }

  private async _evaluateGate(): Promise<boolean> {
    if (this._client.isDisabled) {
      return false
    }

    // `onlyEvaluateLocally` keeps this free: it reads the definitions the poller
    // already caches instead of issuing a `/flags` request, and returns undefined
    // (gate closed) until the first definition load lands. `sendFeatureFlagEvents:
    // false` keeps it silent: the SDK evaluating a flag about itself must not bill
    // the user for a `$feature_flag_called` event on every poll.
    const result = await this._client.getFeatureFlagResult(METRICS_AUTOCAPTURE_FLAG, this._gateDistinctId(), {
      onlyEvaluateLocally: true,
      sendFeatureFlagEvents: false,
      personProperties: this._gatePersonProperties(),
    })
    return result?.enabled === true
  }

  /**
   * Stable for the lifetime of the process and unique per process, so a
   * percentage rollout on the flag buckets processes consistently instead of
   * flip-flopping on every poll.
   *
   * Deliberately random rather than derived from hostname/pid: `HOSTNAME` is
   * unset outside containers and pids repeat, which would hash a whole fleet
   * into the same bucket and make a 10% rollout resolve as 0% or 100%.
   */
  private _gateDistinctId(): string {
    this._gateId ??= `posthog-node-metrics:${this._options.metrics?.serviceName ?? 'unknown-service'}:${uuidv7()}`
    return this._gateId
  }

  private _gatePersonProperties(): Record<string, string> {
    const properties: Record<string, string> = {
      $lib: this._client.getLibraryId(),
      $lib_version: version,
    }
    if (this._options.metrics?.serviceName) {
      properties.service_name = this._options.metrics.serviceName
    }
    if (this._options.metrics?.environment) {
      properties.environment = this._options.metrics.environment
    }
    return properties
  }

  private _startSampling(): void {
    if (this._sampling || this._shutdown) {
      return
    }

    const sampler = this._createSampler()
    if (!sampler) {
      // No sampler for this runtime (e.g. the edge build, where `perf_hooks` and
      // most of `process` don't exist) — nothing to collect.
      return
    }

    const metrics = this._client.metrics
    try {
      sampler.start(metrics)
    } catch (err) {
      // A partial start may already hold an event loop monitor or a GC observer,
      // and this path can be retried on every gate poll — so tear it down rather
      // than leaking one set of handles per poll.
      try {
        sampler.stop()
      } catch {
        // Nothing useful to do if teardown of a failed start also fails.
      }
      this._logger.debug('Could not start runtime metrics sampler:', err)
      return
    }

    this._sampler = sampler
    this._sampling = true
    this._armSampleTimer(metrics)
    this._logger.debug(`Collecting Node runtime metrics every ${this._intervalMs}ms`)
  }

  private _armSampleTimer(metrics: Metrics): void {
    // Re-armed per tick rather than setInterval so a slow sample can't stack up
    // overlapping runs, and so the handle is always the current one to clear.
    this._sampleTimer = safeSetTimeout(() => {
      this._sampleTimer = undefined
      if (this._shutdown || !this._sampler) {
        return
      }
      if (this._client.optedOut) {
        // Every sample would be dropped at capture anyway; skip the work but keep
        // the timer, so opting back in resumes collection.
        this._armSampleTimer(metrics)
        return
      }
      try {
        this._sampler.sample(metrics)
      } catch (err) {
        // One log per client, not one per interval.
        if (!this._sampleErrorLogged) {
          this._sampleErrorLogged = true
          this._logger.warn('Failed to sample Node runtime metrics:', err)
        }
      }
      this._armSampleTimer(metrics)
    }, this._intervalMs)
  }

  private _stopSampling(): void {
    this._sampling = false
    if (this._sampleTimer) {
      clearTimeout(this._sampleTimer)
      this._sampleTimer = undefined
    }
    try {
      this._sampler?.stop()
    } catch (err) {
      this._logger.debug('Could not stop runtime metrics sampler:', err)
    }
    this._sampler = undefined
  }
}

export type { RuntimeMetricsSampler } from './types'
