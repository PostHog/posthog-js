import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createRequire } from 'node:module'
import { metrics as otelMetrics, SpanKind, SpanStatusCode } from '@opentelemetry/api'
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'

import { PostHog } from '@/entrypoints/index.node'
import {
  createDbSpanMetricsProcessor,
  startMetricsAutocapture,
  type MetricsAutocapture,
  type MetricsAutocaptureOptions,
} from '@/extensions/metrics-autocapture.node'

vi.mock('../version', () => ({ version: '1.2.3' }))

const requireForTest = createRequire(import.meta.url)

type Received = { path: string; headers: IncomingMessage['headers']; body: Buffer }

const listen = async (
  handler?: (req: IncomingMessage, body: Buffer) => void
): Promise<{ server: Server; url: string }> => {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      handler?.(req, Buffer.concat(chunks))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }
}

const close = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.closeAllConnections()
    server.close(() => resolve())
  })

const httpGet = (url: string): Promise<void> =>
  new Promise((resolve, reject) => {
    // Required after autocapture starts, so the patched core module is used.
    const http = requireForTest('node:http') as typeof import('node:http')
    http
      .get(url, (res) => {
        res.resume()
        res.on('end', () => resolve())
      })
      .on('error', reject)
  })

const logger = (): MetricsAutocaptureOptions['logger'] & { warn: ReturnType<typeof vi.fn> } => {
  const l: any = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), critical: vi.fn() }
  l.createLogger = () => l
  return l
}

const metricNames = (batches: ResourceMetrics[]): string[] =>
  batches.flatMap((batch) => batch.scopeMetrics.flatMap((scope) => scope.metrics.map((m) => m.descriptor.name)))

const dataPoints = (batches: ResourceMetrics[], name: string): { attributes: Record<string, unknown> }[] =>
  batches.flatMap((batch) =>
    batch.scopeMetrics.flatMap((scope) =>
      scope.metrics.filter((m) => m.descriptor.name === name).flatMap((m) => m.dataPoints as any[])
    )
  )

describe('metrics autocapture', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  describe('startMetricsAutocapture', () => {
    let posthogHost: { server: Server; url: string }
    let appServer: { server: Server; url: string }
    let received: Received[]
    let autocapture: MetricsAutocapture | undefined
    let exporter: InMemoryMetricExporter

    const start = (overrides: Partial<MetricsAutocaptureOptions> = {}, useInMemoryReader = true): void => {
      exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA)
      autocapture = startMetricsAutocapture(
        {
          host: posthogHost.url,
          apiKey: 'phc_test_token',
          config: { http: true, db: true, runtime: true },
          serviceName: 'checkout-api',
          resourceAttributes: { 'deployment.environment': 'test' },
          distroVersion: '1.2.3',
          logger: logger(),
          isEnabled: () => true,
          ...overrides,
        },
        useInMemoryReader
          ? { metricReader: new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 }) }
          : {}
      )
    }

    beforeEach(async () => {
      received = []
      posthogHost = await listen((req, body) => received.push({ path: req.url!, headers: req.headers, body }))
      appServer = await listen()
    })

    afterEach(async () => {
      await autocapture?.shutdown()
      autocapture = undefined
      await close(posthogHost.server)
      await close(appServer.server)
    })

    // First, so it sees freshly built instrumentations, as an app does.
    it('records fetch requests', async () => {
      start()
      await fetch(`${appServer.url}/health`)

      await autocapture!.forceFlush()
      const ports = dataPoints(exporter.getMetrics(), 'http.client.request.duration').map(
        (point) => point.attributes['server.port']
      )
      expect(ports).toContain(Number(new URL(appServer.url).port))
    })

    it('records HTTP server and client request durations', async () => {
      start()
      // A server created after autocapture starts, from the patched module.
      const http = requireForTest('node:http') as typeof import('node:http')
      const server = http.createServer((_req, res) => res.end('ok'))
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      await httpGet(`http://127.0.0.1:${(server.address() as AddressInfo).port}/orders`)
      await new Promise<void>((resolve) => server.close(() => resolve()))

      await autocapture!.forceFlush()
      const names = metricNames(exporter.getMetrics())
      expect(names).toContain('http.server.request.duration')
      expect(names).toContain('http.client.request.duration')
    })

    it('does not record requests to the PostHog host, over http or fetch', async () => {
      start()
      await httpGet(`${posthogHost.url}/i/v1/metrics`)
      await fetch(`${posthogHost.url}/batch/`, { method: 'POST', body: '{}' })
      await httpGet(`${appServer.url}/health`)
      await fetch(`${appServer.url}/health`)

      await autocapture!.forceFlush()
      const ports = dataPoints(exporter.getMetrics(), 'http.client.request.duration').map(
        (point) => point.attributes['server.port']
      )
      const hostPort = Number(new URL(posthogHost.url).port)
      const appPort = Number(new URL(appServer.url).port)
      expect(ports).toContain(appPort)
      expect(ports).not.toContain(hostPort)
    })

    it('exports the runtime gauges in the last window on shutdown', async () => {
      start({ config: { http: false, db: false, runtime: true } }, false)

      await autocapture!.shutdown()
      const body = received
        .filter((r) => r.path === '/i/v1/metrics')
        .map((r) => r.body.toString('latin1'))
        .join('')
      expect(body).toContain('v8js.memory.heap.used')
      expect(body).toContain('nodejs.eventloop.utilization')
    })

    it('measures database calls that have no parent span', async () => {
      start({ config: { http: false, db: true, runtime: false } })

      const instrumentations = (globalThis as any)[Symbol.for('posthog-node.metrics-autocapture.instrumentations')]
      const ioredis = instrumentations.get('@opentelemetry/instrumentation-ioredis')
      expect(ioredis.getConfig()).toMatchObject({ enabled: true, requireParentSpan: false })
    })

    it('records runtime metrics', async () => {
      start({ config: { http: false, db: false, runtime: true } })
      await new Promise((resolve) => setTimeout(resolve, 50))

      await autocapture!.forceFlush()
      const names = metricNames(exporter.getMetrics())
      expect(names.some((name) => name.startsWith('nodejs.eventloop.'))).toBe(true)
      expect(names.some((name) => name.startsWith('v8js.'))).toBe(true)
      expect(names).not.toContain('http.client.request.duration')
    })

    it('exports OTLP to /i/v1/metrics with the project token and the service resource', async () => {
      start({}, false)
      await httpGet(`${appServer.url}/health`)

      await autocapture!.forceFlush()
      const exports = received.filter((r) => r.path === '/i/v1/metrics')
      expect(exports.length).toBeGreaterThan(0)
      expect(exports[0].headers['authorization']).toBe('Bearer phc_test_token')
      expect(exports[0].headers['content-type']).toBe('application/x-protobuf')
      const body = exports.map((r) => r.body.toString('latin1')).join('')
      expect(body).toContain('http.client.request.duration')
      expect(body).toContain('checkout-api')
      expect(body).toContain('telemetry.distro.name')
      expect(body).toContain('posthog-node')
      expect(body).toContain('deployment.environment')
    })

    it('sends nothing while the client is opted out', async () => {
      start({ isEnabled: () => false }, false)
      await httpGet(`${appServer.url}/health`)

      await autocapture!.forceFlush()
      expect(received.filter((r) => r.path === '/i/v1/metrics')).toHaveLength(0)
    })

    it('warns once and returns undefined when the OpenTelemetry packages are missing', () => {
      const log = logger()
      const missing = (): never => {
        const error: NodeJS.ErrnoException = new Error("Cannot find module '@opentelemetry/sdk-metrics'")
        error.code = 'MODULE_NOT_FOUND'
        throw error
      }
      const options: MetricsAutocaptureOptions = {
        host: posthogHost.url,
        apiKey: 'phc_test_token',
        config: { http: true, db: true, runtime: true },
        serviceName: 'checkout-api',
        resourceAttributes: {},
        distroVersion: '1.2.3',
        logger: log,
        isEnabled: () => true,
      }

      expect(() => startMetricsAutocapture(options, { load: missing })).not.toThrow()
      expect(startMetricsAutocapture(options, { load: missing })).toBeUndefined()
      expect(log.warn).toHaveBeenCalledTimes(1)
      expect(log.warn.mock.calls[0].join(' ')).toContain('npm install @opentelemetry/')
    })

    it('does not start when the app already set up OpenTelemetry', async () => {
      const appProvider = new MeterProvider()
      otelMetrics.setGlobalMeterProvider(appProvider)
      try {
        const log = logger()
        start({ logger: log })
        expect(autocapture).toBeUndefined()
        expect(log.warn.mock.calls[0].join(' ')).toContain('OpenTelemetry is already set up')
      } finally {
        otelMetrics.disable()
        await appProvider.shutdown()
      }
    })

    it('runs once per process, and can start again after shutdown', async () => {
      start()
      const log = logger()
      const second = startMetricsAutocapture({
        host: posthogHost.url,
        apiKey: 'phc_test_token',
        config: { http: true, db: true, runtime: true },
        serviceName: 'other',
        resourceAttributes: {},
        distroVersion: '1.2.3',
        logger: log,
        isEnabled: () => true,
      })
      expect(second).toBeUndefined()
      expect(log.warn).toHaveBeenCalledTimes(1)

      await autocapture!.shutdown()
      start()
      expect(autocapture).toBeDefined()
    })
  })

  describe('createDbSpanMetricsProcessor', () => {
    const collect = async (spans: Partial<ReadableSpan>[]): Promise<ResourceMetrics[]> => {
      const exporter = new InMemoryMetricExporter(AggregationTemporality.DELTA)
      const reader = new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })
      const provider = new MeterProvider({ readers: [reader] })
      const processor = createDbSpanMetricsProcessor(provider.getMeter('test'))
      for (const span of spans) {
        processor.onEnd({
          kind: SpanKind.CLIENT,
          duration: [0, 250_000_000],
          status: { code: SpanStatusCode.UNSET },
          instrumentationScope: { name: '@opentelemetry/instrumentation-mysql2' },
          attributes: {},
          ...span,
        } as ReadableSpan)
      }
      await reader.forceFlush()
      const metrics = exporter.getMetrics()
      await provider.shutdown()
      return metrics
    }

    it('turns a database client span into a duration histogram without the statement', async () => {
      const metrics = await collect([
        {
          attributes: {
            'db.system': 'mysql',
            'db.statement': "SELECT * FROM orders WHERE email = 'a@b.c'",
            'db.name': 'shop',
            'net.peer.name': 'db.internal',
          },
        },
      ])

      const points = dataPoints(metrics, 'db.client.operation.duration') as any[]
      expect(points).toHaveLength(1)
      expect(points[0].attributes).toEqual({
        'db.system.name': 'mysql',
        'db.operation.name': 'SELECT',
        'db.namespace': 'shop',
        'server.address': 'db.internal',
      })
      expect(points[0].value.sum).toBeCloseTo(0.25)
      const descriptor = metrics[0].scopeMetrics[0].metrics[0].descriptor
      expect(descriptor.unit).toBe('s')
    })

    it('uses the explicit operation and collection, and marks failures', async () => {
      const metrics = await collect([
        {
          instrumentationScope: { name: '@opentelemetry/instrumentation-mongodb' },
          status: { code: SpanStatusCode.ERROR },
          attributes: {
            'db.system': 'mongodb',
            'db.operation': 'find',
            'db.mongodb.collection': 'orders',
            'db.statement': '{"email":"?"}',
          },
        },
      ])

      const [point] = dataPoints(metrics, 'db.client.operation.duration')
      expect(point.attributes).toEqual({
        'db.system.name': 'mongodb',
        'db.operation.name': 'find',
        'db.collection.name': 'orders',
        'error.type': '_OTHER',
      })
    })

    it('skips spans that are not driver-level database client calls', async () => {
      const metrics = await collect([
        // pg records db.client.operation.duration itself.
        {
          instrumentationScope: { name: '@opentelemetry/instrumentation-pg' },
          attributes: { 'db.system': 'postgresql' },
        },
        // knex wraps a driver span, so counting it would count the query twice.
        { instrumentationScope: { name: '@opentelemetry/instrumentation-knex' }, attributes: { 'db.system': 'mysql' } },
        { kind: SpanKind.SERVER, attributes: { 'db.system': 'mysql' } },
        { attributes: { 'http.request.method': 'GET' } },
      ])

      expect(dataPoints(metrics, 'db.client.operation.duration')).toHaveLength(0)
    })
  })

  describe('PostHog client option', () => {
    let posthogHost: { server: Server; url: string }

    beforeEach(async () => {
      posthogHost = await listen()
    })

    afterEach(async () => {
      await close(posthogHost.server)
    })

    const tryStart = (): MetricsAutocapture | undefined =>
      startMetricsAutocapture({
        host: posthogHost.url,
        apiKey: 'phc_test_token',
        config: { http: true, db: true, runtime: true },
        serviceName: 'probe',
        resourceAttributes: {},
        distroVersion: '1.2.3',
        logger: logger(),
        isEnabled: () => true,
      })

    it('starts autocapture with metrics.autocapture and stops it on shutdown', async () => {
      const posthog = new PostHog('phc_test_token', { host: posthogHost.url, metrics: { autocapture: true } })
      expect(tryStart()).toBeUndefined()

      await posthog.shutdown()
      const probe = tryStart()
      expect(probe).toBeDefined()
      await probe!.shutdown()
    })

    it('does not start autocapture by default or when the client is disabled', async () => {
      const plain = new PostHog('phc_test_token', { host: posthogHost.url })
      const disabled = new PostHog('phc_test_token', {
        host: posthogHost.url,
        disabled: true,
        metrics: { autocapture: true },
      })

      const probe = tryStart()
      expect(probe).toBeDefined()
      await probe!.shutdown()
      await plain.shutdown()
      await disabled.shutdown()
    })
  })
})
