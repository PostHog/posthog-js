import type { Metrics } from '@posthog/core'

/**
 * A source of runtime metrics, sampled on an interval by {@link MetricsAutocapture}.
 *
 * The interface exists so the runtime-agnostic autocapture loop stays free of
 * Node built-ins: the concrete sampler (`RuntimeMetricsCollector`, which imports
 * `node:perf_hooks` and friends) is injected by the Node entrypoint, exactly how
 * `PostHogContext` and the error-tracking frame modifiers are wired.
 *
 * @internal — an SDK-internal seam, not something users implement.
 */
export interface RuntimeMetricsSampler {
  /** Starts anything that must run between samples (e.g. histograms, observers). */
  start(metrics: Metrics): void
  /** Records one sample of every available series. */
  sample(metrics: Metrics): void
  /** Tears down whatever `start` began. Must be safe to call twice. */
  stop(): void
}
