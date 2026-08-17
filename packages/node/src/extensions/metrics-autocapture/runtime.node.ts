import { constants, monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { getHeapStatistics } from 'node:v8'
import type { Metrics } from '@posthog/core'
import type { RuntimeMetricsSampler } from './types'

/**
 * Samples low-level Node runtime metrics into the `posthog.metrics` client.
 *
 * Everything here comes from APIs the process already has, so there is nothing
 * for the user to instrument — the same trade autocapture makes for events.
 *
 * Two constraints shape these series:
 *
 * - **Cardinality.** Every attribute combination is its own series, so the only
 *   attributes used are closed enums (`state`, `type`, `stat`, `kind`). Nothing
 *   per-host or per-instance is attached; service/environment identity comes from
 *   the resource attributes on the `metrics` client config. The cost of that
 *   choice is that gauges from several replicas of one service land on the same
 *   series and overwrite each other — an instance attribute is the obvious next
 *   step, and the obvious cardinality trade to argue about first.
 * - **Cheap sampling.** Every read is an O(1) process-local counter folded into
 *   the pre-aggregating metrics client, so a sample is a handful of `gauge()`
 *   calls rather than any syscall-heavy work.
 */
export class RuntimeMetricsCollector implements RuntimeMetricsSampler {
  private _lastCpuUsage?: NodeJS.CpuUsage
  private _lastSampleAtMs?: number
  private _lastEventLoopUtilization?: ReturnType<typeof performance.eventLoopUtilization>
  private _eventLoopDelay?: ReturnType<typeof monitorEventLoopDelay>
  private _gcObserver?: PerformanceObserver
  private _cpuCount = 1

  /**
   * Starts the collectors that have to be running *between* samples: the event
   * loop delay histogram and the GC observer. Everything else is a
   * point-in-time read taken during `sample()`.
   */
  start(metrics: Metrics): void {
    this._cpuCount = detectCpuCount()
    this._lastCpuUsage = process.cpuUsage()
    this._lastSampleAtMs = Date.now()
    this._lastEventLoopUtilization = performance.eventLoopUtilization()

    // 10ms resolution: fine enough to see a blocked loop, coarse enough that the
    // libuv timer doing the sampling isn't itself a cost.
    this._eventLoopDelay = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS })
    this._eventLoopDelay.enable()

    // The only unbounded-rate emission here: a busy process GCs thousands of
    // times a second, all folded into one histogram series per kind. Note the
    // default bucket bounds start at 5ms, so sub-ms scavenges all land in the
    // first bucket — count, sum and max are what carry the signal.
    this._gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        metrics.histogram('process.gc.duration', entry.duration, {
          unit: 'ms',
          attributes: { kind: gcKind((entry as PerformanceEntry & { detail?: { kind?: number } }).detail?.kind) },
        })
      }
    })
    this._gcObserver.observe({ entryTypes: ['gc'] })
  }

  /** Records one sample of every available runtime series. */
  sample(metrics: Metrics): void {
    const nowMs = Date.now()

    try {
      this._sampleCpu(metrics, nowMs)
      this._sampleMemory(metrics)
      this._sampleEventLoop(metrics)
      this._sampleProcess(metrics)
    } finally {
      // In a `finally` because `_sampleCpu` has already advanced its own cursor: a
      // throw further down must not leave the two out of step, or every later CPU
      // delta gets divided by a too-long window and utilization reads far too low.
      this._lastSampleAtMs = nowMs
    }
  }

  stop(): void {
    this._eventLoopDelay?.disable()
    this._eventLoopDelay = undefined
    this._gcObserver?.disconnect()
    this._gcObserver = undefined
  }

  private _sampleCpu(metrics: Metrics, nowMs: number): void {
    const usage = process.cpuUsage()
    const previous = this._lastCpuUsage
    this._lastCpuUsage = usage
    if (!previous || this._lastSampleAtMs === undefined) {
      return
    }

    const userDeltaMicros = usage.user - previous.user
    const systemDeltaMicros = usage.system - previous.system

    // `process.cpu.time` is a counter in seconds per the OTel semantic
    // convention, and per-window deltas are what delta temporality wants anyway.
    metrics.count('process.cpu.time', userDeltaMicros / MICROS_PER_SECOND, {
      unit: 's',
      attributes: { state: 'user' },
    })
    metrics.count('process.cpu.time', systemDeltaMicros / MICROS_PER_SECOND, {
      unit: 's',
      attributes: { state: 'system' },
    })

    const elapsedMs = nowMs - this._lastSampleAtMs
    if (elapsedMs > 0) {
      // Fraction of the CPU capacity available to this process (see
      // `detectCpuCount`), so 1.0 means saturated — cpuUsage() sums every thread,
      // hence the division.
      const utilization = (userDeltaMicros + systemDeltaMicros) / (elapsedMs * MILLIS_TO_MICROS) / this._cpuCount
      metrics.gauge('process.cpu.utilization', clampNonNegative(utilization))
    }
  }

  private _sampleMemory(metrics: Metrics): void {
    const memory = process.memoryUsage()
    const byType: Record<string, number | undefined> = {
      rss: memory.rss,
      heap_used: memory.heapUsed,
      heap_total: memory.heapTotal,
      external: memory.external,
      array_buffers: memory.arrayBuffers,
    }
    for (const [type, value] of Object.entries(byType)) {
      if (typeof value === 'number') {
        metrics.gauge('process.memory.usage', value, { unit: 'byte', attributes: { type } })
      }
    }

    // The heap limit is what heap_used is actually racing against, so ship it as
    // its own series instead of making the reader guess the ceiling.
    metrics.gauge('process.memory.heap_limit', getHeapStatistics().heap_size_limit, { unit: 'byte' })
  }

  private _sampleEventLoop(metrics: Metrics): void {
    const histogram = this._eventLoopDelay
    if (histogram) {
      const stats: Record<string, number> = {
        mean: histogram.mean,
        p50: histogram.percentile(50),
        p90: histogram.percentile(90),
        p99: histogram.percentile(99),
        max: histogram.max,
      }
      for (const [stat, valueNanos] of Object.entries(stats)) {
        if (Number.isFinite(valueNanos)) {
          // Node records the full interval between monitor ticks, so an idle
          // process reports ~`resolution` on every stat. Report the excess over
          // the resolution instead, so 0 means "not delayed" as a reader expects.
          const delayMs = Math.max(0, valueNanos / NANOS_PER_MILLI - EVENT_LOOP_RESOLUTION_MS)
          metrics.gauge('process.event_loop.delay', delayMs, { unit: 'ms', attributes: { stat } })
        }
      }
      // Reset so each window reports the delay seen during that window, rather
      // than a since-boot distribution that never recovers from one bad spike.
      histogram.reset()
    }

    const current = performance.eventLoopUtilization()
    const delta = this._lastEventLoopUtilization
      ? performance.eventLoopUtilization(current, this._lastEventLoopUtilization)
      : current
    this._lastEventLoopUtilization = current
    if (Number.isFinite(delta.utilization)) {
      metrics.gauge('process.event_loop.utilization', clampNonNegative(delta.utilization))
    }
  }

  private _sampleProcess(metrics: Metrics): void {
    metrics.gauge('process.uptime', process.uptime(), { unit: 's' })
    // A steadily climbing handle count is the cheapest leak signal there is.
    metrics.gauge('process.active_resources', process.getActiveResourcesInfo().length)
  }
}

const NANOS_PER_MILLI = 1e6
const MICROS_PER_SECOND = 1e6
const MILLIS_TO_MICROS = 1000
const EVENT_LOOP_RESOLUTION_MS = 10

/**
 * CPU capacity available to *this process*, for the utilization ratio.
 *
 * `os.cpus().length` reports the host's cores, which in a container is the wrong
 * denominator by one to two orders of magnitude: a pod limited to 500m on a
 * 64-core node would report 0.008 while pegged at its quota. The cgroup quota is
 * the number that makes 1.0 mean "saturated".
 */
function detectCpuCount(): number {
  const quota = readCgroupCpuQuota()
  if (quota !== undefined && quota > 0) {
    return quota
  }
  try {
    return Math.max(1, availableParallelism())
  } catch {
    return 1
  }
}

function readCgroupCpuQuota(): number | undefined {
  return parseCgroupCpuQuota({
    cpuMax: readFileIfPresent('/sys/fs/cgroup/cpu.max'),
    cfsQuotaUs: readFileIfPresent('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'),
    cfsPeriodUs: readFileIfPresent('/sys/fs/cgroup/cpu/cpu.cfs_period_us'),
  })
}

/**
 * Cores allowed by the cgroup, or `undefined` when unlimited or unreadable.
 * Split out from the file reads so it can be tested without a container.
 */
export function parseCgroupCpuQuota({
  cpuMax,
  cfsQuotaUs,
  cfsPeriodUs,
}: {
  cpuMax?: string
  cfsQuotaUs?: string
  cfsPeriodUs?: string
}): number | undefined {
  // cgroup v2: "<quota|max> <period>", both in microseconds.
  if (cpuMax) {
    const [quota, period] = cpuMax.trim().split(/\s+/)
    if (quota === 'max') {
      return undefined
    }
    if (Number(quota) > 0 && Number(period) > 0) {
      return Number(quota) / Number(period)
    }
  }

  // cgroup v1: a quota of -1 means unlimited.
  const quotaV1 = Number(cfsQuotaUs)
  const periodV1 = Number(cfsPeriodUs)
  if (quotaV1 > 0 && periodV1 > 0) {
    return quotaV1 / periodV1
  }

  return undefined
}

function readFileIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** Maps the numeric perf_hooks GC kind onto a bounded attribute value. */
function gcKind(kind: number | undefined): string {
  switch (kind) {
    case constants.NODE_PERFORMANCE_GC_MINOR:
      return 'minor'
    case constants.NODE_PERFORMANCE_GC_MAJOR:
      return 'major'
    case constants.NODE_PERFORMANCE_GC_INCREMENTAL:
      return 'incremental'
    case constants.NODE_PERFORMANCE_GC_WEAKCB:
      return 'weak_callbacks'
    default:
      return 'unknown'
  }
}

function clampNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0
}
