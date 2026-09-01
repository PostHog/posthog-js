import { resolveTracesConfig } from '../traces-defaults'

describe('resolveTracesConfig', () => {
  it('applies the documented defaults', () => {
    expect(resolveTracesConfig(undefined)).toMatchObject({
      flushIntervalMs: 5000,
      maxExportBatchSize: 512,
      maxQueueSize: 2048,
      maxLiveSpans: 10_000,
      maxSpanAgeMs: 3_600_000,
    })
  })

  it('honours explicit live-span bounds', () => {
    expect(resolveTracesConfig({ maxLiveSpans: 50, maxSpanAgeMs: 30_000 })).toMatchObject({
      maxLiveSpans: 50,
      maxSpanAgeMs: 30_000,
    })
  })

  it.each([0, -1, Number.NaN])('falls back to the defaults for unusable live-span bounds (%p)', (value) => {
    expect(resolveTracesConfig({ maxLiveSpans: value, maxSpanAgeMs: value })).toMatchObject({
      maxLiveSpans: 10_000,
      maxSpanAgeMs: 3_600_000,
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

  it('honours an explicit maxQueueSize', () => {
    expect(resolveTracesConfig({ maxQueueSize: 100_000 }).maxQueueSize).toBe(100_000)
  })

  it('floors an explicit maxQueueSize at the export batch size', () => {
    expect(resolveTracesConfig({ maxExportBatchSize: 512, maxQueueSize: 10 }).maxQueueSize).toBe(512)
  })

  it('attaches the host resource attributes the entrypoint supplies', () => {
    expect(
      resolveTracesConfig(undefined, { 'os.name': 'linux', 'os.version': '6.1.0-27-amd64' }).resourceAttributes
    ).toEqual({ 'os.name': 'linux', 'os.version': '6.1.0-27-amd64' })
  })

  it('lets user resource attributes override the host ones', () => {
    expect(
      resolveTracesConfig(
        { resourceAttributes: { 'os.name': 'my-os', 'os.version': '1.2.3' } },
        { 'os.name': 'linux', 'os.version': '6.1.0-27-amd64' }
      ).resourceAttributes
    ).toEqual({ 'os.name': 'my-os', 'os.version': '1.2.3' })
  })

  it('resolves when the entrypoint supplies no host attributes', () => {
    expect(resolveTracesConfig({ resourceAttributes: { 'host.name': 'worker-01' } }).resourceAttributes).toEqual({
      'host.name': 'worker-01',
    })
  })
})

describe('resourceAttributes guarding', () => {
  it('ignores a non-object value', () => {
    const { resourceAttributes } = resolveTracesConfig({ resourceAttributes: 'oops' as never })

    expect(Object.keys(resourceAttributes ?? {})).toEqual([])
  })

  it('ignores an array, which would otherwise spread as numeric keys', () => {
    const { resourceAttributes } = resolveTracesConfig({
      resourceAttributes: [{ key: 'service.name' }] as never,
    })

    expect(Object.keys(resourceAttributes ?? {})).not.toContain('0')
  })

  it('drops an identity key that is not a string', () => {
    const resolved = resolveTracesConfig({
      serviceName: 'checkout-api',
      resourceAttributes: { 'service.name': 12345 as never, region: 'us' },
    })

    expect(resolved.serviceName).toBe('checkout-api')
    expect(resolved.resourceAttributes).toEqual({ region: 'us' })
  })

  it('does not throw when an identity accessor throws', () => {
    const hostile = {}
    Object.defineProperty(hostile, 'service.name', {
      enumerable: true,
      get() {
        throw new Error('config getter exploded')
      },
    })

    expect(() => resolveTracesConfig({ resourceAttributes: hostile as never })).not.toThrow()
  })

  it('does not throw when a non-identity accessor throws', () => {
    const hostile = { 'service.name': 'checkout-api' }
    Object.defineProperty(hostile, 'region', {
      enumerable: true,
      get() {
        throw new Error('config getter exploded')
      },
    })

    expect(() => resolveTracesConfig({ resourceAttributes: hostile as never }, { 'os.name': 'Linux' })).not.toThrow()
  })

  it('keeps the readable attributes when one accessor throws', () => {
    const hostile = { region: 'us' }
    Object.defineProperty(hostile, 'tenant', {
      enumerable: true,
      get() {
        throw new Error('config getter exploded')
      },
    })

    const resolved = resolveTracesConfig({ resourceAttributes: hostile as never }, { 'os.name': 'Linux' })

    expect(resolved.resourceAttributes).toMatchObject({ 'os.name': 'Linux', region: 'us' })
  })
})
