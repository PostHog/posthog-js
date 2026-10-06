import { createRequire } from 'node:module'
import type { Attributes, Meter, SpanKind as OtelSpanKind } from '@opentelemetry/api'
import type { MetricReader, PushMetricExporter } from '@opentelemetry/sdk-metrics'
import type { ReadableSpan, Sampler, SpanProcessor } from '@opentelemetry/sdk-trace-base'
import { allSettled, type Logger } from '@posthog/core'

/**
 * Metrics autocapture: HTTP, database and runtime metrics from the official
 * OpenTelemetry instrumentations, exported to PostHog with no instrumentation
 * code in the app.
 *
 * Node-only, like the other `.node` modules. The OpenTelemetry packages are
 * optional peer dependencies, loaded here on first use, so an app that never
 * turns autocapture on loads none of them.
 *
 * The meter and tracer providers are private: nothing is registered on the
 * OpenTelemetry globals, so the app's own OpenTelemetry setup (if it adds one
 * later) is not changed. Spans are only used to derive database metrics and are
 * never exported.
 */

export interface MetricsAutocaptureAreas {
  http: boolean
  db: boolean
  runtime: boolean
}

export interface MetricsAutocaptureOptions {
  host: string
  apiKey: string
  config: MetricsAutocaptureAreas
  serviceName?: string
  resourceAttributes: Record<string, string | number | boolean>
  distroVersion: string
  logger: Logger
  /** Read before each export, so an opted-out client sends nothing. */
  isEnabled: () => boolean
  exportIntervalMs?: number
}

export interface MetricsAutocapture {
  forceFlush(): Promise<void>
  shutdown(): Promise<void>
}

type Load = ((id: string) => any) & { resolve?: (id: string) => string }

export const METRICS_AUTOCAPTURE_PACKAGES = [
  '@opentelemetry/api',
  '@opentelemetry/sdk-metrics',
  '@opentelemetry/sdk-trace-base',
  '@opentelemetry/resources',
  '@opentelemetry/exporter-metrics-otlp-proto',
  '@opentelemetry/auto-instrumentations-node',
]

const INSTALL_COMMAND = `npm install ${METRICS_AUTOCAPTURE_PACKAGES.join(' ')}`

const HTTP_INSTRUMENTATIONS = ['@opentelemetry/instrumentation-http', '@opentelemetry/instrumentation-undici']

// Driver-level instrumentations only. ORM and query-builder layers (knex,
// mongoose) wrap a driver span, so instrumenting both would count one query twice.
const DB_INSTRUMENTATIONS = [
  '@opentelemetry/instrumentation-pg',
  '@opentelemetry/instrumentation-mysql',
  '@opentelemetry/instrumentation-mysql2',
  '@opentelemetry/instrumentation-mongodb',
  '@opentelemetry/instrumentation-redis',
  '@opentelemetry/instrumentation-ioredis',
  '@opentelemetry/instrumentation-tedious',
  '@opentelemetry/instrumentation-cassandra-driver',
  '@opentelemetry/instrumentation-memcached',
  '@opentelemetry/instrumentation-oracledb',
]

const RUNTIME_INSTRUMENTATIONS = ['@opentelemetry/instrumentation-runtime-node']

// These record `db.client.operation.duration` themselves.
const NATIVE_DB_METRIC_SCOPES = new Set([
  '@opentelemetry/instrumentation-pg',
  '@opentelemetry/instrumentation-oracledb',
])
const DERIVED_DB_METRIC_SCOPES = new Set(DB_INSTRUMENTATIONS.filter((name) => !NATIVE_DB_METRIC_SCOPES.has(name)))

const DB_OPERATION_DURATION = 'db.client.operation.duration'
// OpenTelemetry semantic convention advice for `db.client.operation.duration`.
const DB_DURATION_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10]

const SPAN_KIND_CLIENT = 2 as OtelSpanKind
const SPAN_STATUS_ERROR = 2

// On globalThis rather than in module scope, so the CommonJS and ESM builds
// loaded side by side still share one instrumentation set per process.
const ACTIVE = Symbol.for('posthog-node.metrics-autocapture')
const INSTRUMENTATIONS = Symbol.for('posthog-node.metrics-autocapture.instrumentations')

let warnedAboutMissingPackages = false

const firstString = (attributes: Attributes, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = attributes[key]
    if (typeof value === 'string' && value) {
      return value
    }
  }
  return undefined
}

// The leading keyword (`SELECT`, `GET`) is bounded; the rest of a statement is not.
const operationFromStatement = (statement: string | undefined): string | undefined => {
  const keyword = statement?.match(/^\s*([A-Za-z]{2,20})\b/)?.[1]
  return keyword?.toUpperCase()
}

/**
 * Turns driver-level database client spans into a `db.client.operation.duration`
 * histogram. Only bounded attributes are kept: never the statement, which holds
 * values, and never anything per-user.
 */
export function createDbSpanMetricsProcessor(meter: Meter): SpanProcessor {
  const histogram = meter.createHistogram(DB_OPERATION_DURATION, {
    unit: 's',
    description: 'Duration of database client operations.',
    advice: { explicitBucketBoundaries: DB_DURATION_BUCKETS },
  })

  return {
    onStart: () => {},
    onEnd: (span: ReadableSpan) => {
      if (span.kind !== SPAN_KIND_CLIENT || !DERIVED_DB_METRIC_SCOPES.has(span.instrumentationScope?.name)) {
        return
      }
      const attributes = span.attributes
      const system = firstString(attributes, ['db.system.name', 'db.system'])
      if (!system) {
        return
      }
      const metricAttributes: Attributes = { 'db.system.name': system }
      const operation =
        firstString(attributes, ['db.operation.name', 'db.operation']) ??
        operationFromStatement(firstString(attributes, ['db.query.text', 'db.statement']))
      const collection = firstString(attributes, [
        'db.collection.name',
        'db.mongodb.collection',
        'db.sql.table',
        'db.cassandra.table',
      ])
      const namespace = firstString(attributes, ['db.namespace', 'db.name'])
      const address = firstString(attributes, ['server.address', 'net.peer.name'])
      const port = attributes['server.port'] ?? attributes['net.peer.port']
      if (operation) {
        metricAttributes['db.operation.name'] = operation
      }
      if (collection) {
        metricAttributes['db.collection.name'] = collection
      }
      if (namespace) {
        metricAttributes['db.namespace'] = namespace
      }
      if (address) {
        metricAttributes['server.address'] = address
      }
      if (typeof port === 'number') {
        metricAttributes['server.port'] = port
      }
      if (span.status?.code === SPAN_STATUS_ERROR) {
        metricAttributes['error.type'] = firstString(attributes, ['error.type']) ?? '_OTHER'
      }
      const [seconds, nanos] = span.duration
      histogram.record(seconds + nanos / 1e9, metricAttributes)
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  }
}

// Records only client spans, the kind a database call makes; server spans stay
// no-ops. Not every driver sets `db.system` when the span starts, so the kind is
// all a sampler can check.
const clientSpansOnlySampler = (decisions: { NOT_RECORD: number; RECORD: number }): Sampler => ({
  shouldSample: (_context, _traceId, _name, kind) => ({
    decision: kind === SPAN_KIND_CLIENT ? decisions.RECORD : decisions.NOT_RECORD,
  }),
  toString: () => 'PostHogClientSpansOnlySampler',
})

const isNoopProvider = (provider: any): boolean => {
  const delegate = typeof provider?.getDelegate === 'function' ? provider.getDelegate() : provider
  return /^Noop/.test(delegate?.constructor?.name ?? '')
}

// The exporter still sends while the client is opted out unless it is gated here.
const gateExporter = (exporter: PushMetricExporter, isEnabled: () => boolean): PushMetricExporter => ({
  export: (metrics, resultCallback) => {
    if (!isEnabled()) {
      resultCallback({ code: 0 })
      return
    }
    exporter.export(metrics, resultCallback)
  },
  forceFlush: () => exporter.forceFlush(),
  shutdown: () => exporter.shutdown(),
  selectAggregationTemporality: exporter.selectAggregationTemporality?.bind(exporter),
  selectAggregation: exporter.selectAggregation?.bind(exporter),
})

const defaultPort = (protocol: string | undefined): number => (protocol === 'https:' ? 443 : 80)

const instrumentationClass = (module: Record<string, unknown>): (new (config?: object) => any) | undefined =>
  Object.values(module).find(
    (value): value is new (config?: object) => any => typeof value === 'function' && /Instrumentation$/.test(value.name)
  )

/**
 * Starts metrics autocapture. Returns `undefined`, after one warning, when the
 * OpenTelemetry packages are missing, when OpenTelemetry is already set up in
 * the process, or when autocapture is already running. Never throws.
 */
export function startMetricsAutocapture(
  options: MetricsAutocaptureOptions,
  overrides: { metricReader?: MetricReader; load?: Load } = {}
): MetricsAutocapture | undefined {
  const { logger, config } = options
  const globals = globalThis as { [ACTIVE]?: MetricsAutocapture; [INSTRUMENTATIONS]?: Map<string, any> }
  if (globals[ACTIVE]) {
    logger.warn('Metrics autocapture is already running in this process, so this client does not start it again.')
    return undefined
  }

  const load: Load = overrides.load ?? createRequire(import.meta.url)
  let otel: {
    api: typeof import('@opentelemetry/api')
    sdkMetrics: typeof import('@opentelemetry/sdk-metrics')
    sdkTrace: typeof import('@opentelemetry/sdk-trace-base')
    resources: typeof import('@opentelemetry/resources')
    exporter: typeof import('@opentelemetry/exporter-metrics-otlp-proto')
    loadInstrumentation: (name: string) => Record<string, unknown>
  }
  try {
    const autoInstrumentationsPath = load.resolve?.('@opentelemetry/auto-instrumentations-node')
    // The individual instrumentations are dependencies of the meta-package, so
    // they resolve from its location even under strict package managers.
    const loadInstrumentation: Load = autoInstrumentationsPath ? createRequire(autoInstrumentationsPath) : load
    otel = {
      api: load('@opentelemetry/api'),
      sdkMetrics: load('@opentelemetry/sdk-metrics'),
      sdkTrace: load('@opentelemetry/sdk-trace-base'),
      resources: load('@opentelemetry/resources'),
      exporter: load('@opentelemetry/exporter-metrics-otlp-proto'),
      loadInstrumentation,
    }
  } catch (error) {
    if (!warnedAboutMissingPackages) {
      warnedAboutMissingPackages = true
      logger.warn(
        `Metrics autocapture needs the OpenTelemetry packages. Install them with: ${INSTALL_COMMAND}`,
        error instanceof Error ? error.message : error
      )
    }
    return undefined
  }

  try {
    const { api, sdkMetrics, sdkTrace, resources, exporter } = otel
    if (!isNoopProvider(api.metrics.getMeterProvider()) || !isNoopProvider(api.trace.getTracerProvider())) {
      logger.warn(
        'OpenTelemetry is already set up in this process, so metrics autocapture does not start. ' +
          'Point your OTLP metrics exporter at PostHog instead: https://posthog.com/docs/metrics'
      )
      return undefined
    }

    const hostUrl = new URL(options.host)
    const hostPort = Number(hostUrl.port) || defaultPort(hostUrl.protocol)
    const isPostHogRequest = (hostname: string | undefined, port: number): boolean =>
      hostname === hostUrl.hostname && port === hostPort

    const resource = resources.resourceFromAttributes({
      'service.name': options.serviceName || process.env.OTEL_SERVICE_NAME || 'unknown_service',
      ...options.resourceAttributes,
      'telemetry.distro.name': 'posthog-node',
      'telemetry.distro.version': options.distroVersion,
    })

    const reader =
      overrides.metricReader ??
      new sdkMetrics.PeriodicExportingMetricReader({
        exporter: gateExporter(
          new exporter.OTLPMetricExporter({
            url: `${options.host}/i/v1/metrics`,
            headers: { Authorization: `Bearer ${options.apiKey}` },
            temporalityPreference: sdkMetrics.AggregationTemporality.DELTA,
          }),
          options.isEnabled
        ),
        exportIntervalMillis: options.exportIntervalMs ?? 10000,
      })
    const meterProvider = new sdkMetrics.MeterProvider({ resource, readers: [reader] })
    const tracerProvider = new sdkTrace.BasicTracerProvider({
      resource,
      sampler: clientSpansOnlySampler(sdkTrace.SamplingDecision),
      spanProcessors: config.db
        ? [createDbSpanMetricsProcessor(meterProvider.getMeter('posthog-node.metrics-autocapture'))]
        : [],
    })

    // Some drivers (ioredis, redis) skip calls with no parent span by default, and
    // without a context manager no call has one.
    const dbConfig = { requireParentSpan: false }
    const instrumentationConfig: Record<string, object> = {
      ...Object.fromEntries(DB_INSTRUMENTATIONS.map((name) => [name, dbConfig])),
      '@opentelemetry/instrumentation-http': {
        ignoreOutgoingRequestHook: (request: {
          hostname?: string
          host?: string
          port?: number | string
          protocol?: string
        }) =>
          isPostHogRequest(
            request.hostname ?? request.host?.replace(/:\d+$/, ''),
            Number(request.port) || defaultPort(request.protocol ?? undefined)
          ),
      },
      '@opentelemetry/instrumentation-undici': {
        ignoreRequestHook: (request: { origin: string }) => {
          const url = new URL(request.origin)
          return isPostHogRequest(url.hostname, Number(url.port) || defaultPort(url.protocol))
        },
      },
    }
    const names = [
      ...(config.http ? HTTP_INSTRUMENTATIONS : []),
      ...(config.db ? DB_INSTRUMENTATIONS : []),
      ...(config.runtime ? RUNTIME_INSTRUMENTATIONS : []),
    ]
    // One instance per instrumentation per process, enabled again on each start.
    // The require hook remembers a module it has already handed out, so a new
    // instance would never see `http` again after the first one was disabled.
    const cache = (globals[INSTRUMENTATIONS] ??= new Map())
    const instrumentations = names.flatMap((name) => {
      try {
        let instrumentation = cache.get(name)
        if (!instrumentation) {
          const Instrumentation = instrumentationClass(otel.loadInstrumentation(name))
          if (!Instrumentation) {
            return []
          }
          // Disabled until it has our providers.
          instrumentation = new Instrumentation({ enabled: false })
          cache.set(name, instrumentation)
        }
        // Also clears `enabled: false`, which some instrumentations (undici) check on every request.
        instrumentation.setConfig(instrumentationConfig[name] ?? {})
        return [instrumentation]
      } catch (error) {
        logger.debug(`Metrics autocapture skipped ${name}`, error)
        return []
      }
    })
    for (const instrumentation of instrumentations) {
      instrumentation.setTracerProvider(tracerProvider)
      instrumentation.setMeterProvider(meterProvider)
      instrumentation.enable()
    }

    const handle: MetricsAutocapture = {
      forceFlush: () => meterProvider.forceFlush(),
      shutdown: async () => {
        if (globals[ACTIVE] !== handle) {
          return
        }
        delete globals[ACTIVE]
        // Export first: disabling removes the runtime gauges' callbacks, so they
        // would be missing from the last window.
        await allSettled([meterProvider.forceFlush()])
        for (const instrumentation of instrumentations) {
          instrumentation.disable()
        }
        await allSettled([meterProvider.shutdown(), tracerProvider.shutdown()])
      },
    }
    globals[ACTIVE] = handle
    return handle
  } catch (error) {
    logger.error('Metrics autocapture failed to start', error)
    return undefined
  }
}
