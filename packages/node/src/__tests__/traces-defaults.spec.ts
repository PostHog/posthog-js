import { resolveTracesConfig } from '../traces-defaults'

describe('resolveTracesConfig', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['not a number', NaN],
  ])('falls back to the default per-span caps when given %s', (_label, value) => {
    const resolved = resolveTracesConfig({ maxAttributesPerSpan: value, maxEventsPerSpan: value })
    expect(resolved.maxAttributesPerSpan).toBe(128)
    expect(resolved.maxEventsPerSpan).toBe(128)
  })

  it('applies the documented defaults', () => {
    expect(resolveTracesConfig(undefined)).toMatchObject({
      flushIntervalMs: 5000,
      maxExportBatchSize: 512,
      maxQueueSize: 2048,
      maxAttributesPerSpan: 128,
      maxEventsPerSpan: 128,
    })
  })

  it('leaves serviceName unset so core supplies unknown_service', () => {
    expect(resolveTracesConfig({}).serviceName).toBeUndefined()
  })

  it('honours explicit values', () => {
    expect(
      resolveTracesConfig({ serviceName: 'checkout', flushIntervalMs: 1000, maxExportBatchSize: 50 })
    ).toMatchObject({
      serviceName: 'checkout',
      flushIntervalMs: 1000,
      maxExportBatchSize: 50,
    })
  })

  it('lets OTLP resource attributes override the named fields', () => {
    const resolved = resolveTracesConfig({
      serviceName: 'named',
      serviceVersion: '1.0.0',
      environment: 'staging',
      resourceAttributes: {
        'service.name': 'from-attributes',
        'service.version': '2.0.0',
        'deployment.environment': 'production',
      },
    })

    expect(resolved.serviceName).toBe('from-attributes')
    expect(resolved.serviceVersion).toBe('2.0.0')
    expect(resolved.environment).toBe('production')
  })

  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back to the default for an unusable maxExportBatchSize (%p)',
    (value) => {
      // A non-positive batch size reaches an export loop that cannot make
      // progress with it, so it spins forever posting empty batches.
      expect(resolveTracesConfig({ maxExportBatchSize: value }).maxExportBatchSize).toBe(512)
    }
  )

  it('floors a fractional batch size to an integer', () => {
    expect(resolveTracesConfig({ maxExportBatchSize: 10.9 }).maxExportBatchSize).toBe(10)
  })

  it.each([0, -1, Number.NaN])('falls back to the default for an unusable flushIntervalMs (%p)', (value) => {
    expect(resolveTracesConfig({ flushIntervalMs: value }).flushIntervalMs).toBe(5000)
  })

  it('keeps the queue at least as large as the export batch', () => {
    // A queue smaller than the flush trigger would stop the depth-based flush
    // from ever firing.
    expect(resolveTracesConfig({ maxExportBatchSize: 5000 }).maxQueueSize).toBe(5000)
    expect(resolveTracesConfig({ maxExportBatchSize: 10 }).maxQueueSize).toBe(2048)
  })
})
