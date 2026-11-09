import { PostHog, PostHogOptions } from '@/entrypoints/index.node'

vi.mock('../version', () => ({ version: '1.2.3' }))

const mockedFetch = vi.spyOn(globalThis, 'fetch').mockImplementation()

const options: PostHogOptions = {
  host: 'http://example.com',
  disableCompression: true,
  fetchRetryCount: 0,
  metrics: { serviceName: 'test-service' },
  logs: { serviceName: 'test-service' },
}

const callsTo = (path: string): [string, any][] =>
  mockedFetch.mock.calls.filter((call) => (call[0] as string).includes(path)) as [string, any][]

const resourceAttr = (body: any, key: string): unknown =>
  (body.resourceMetrics ?? body.resourceLogs)[0].resource.attributes.find((a: any) => a.key === key)?.value
    ?.stringValue

describe('service.instance.id', () => {
  vi.useFakeTimers()

  beforeEach(() => {
    mockedFetch.mockReset()
    mockedFetch.mockResolvedValue({ status: 200, text: async () => '' } as any)
  })

  it('is unique per client and shared by its metrics and logs', async () => {
    const clients = [new PostHog('TEST_API_KEY', options), new PostHog('TEST_API_KEY', options)]
    for (const client of clients) {
      client.metrics.count('jobs.processed')
      await client.metrics.flush()
      client.logger.info('ready')
      await client.flush()
    }
    const ids = (path: string): unknown[] =>
      callsTo(path).map(([, init]) => resourceAttr(JSON.parse(init.body), 'service.instance.id'))
    const metricIds = ids('/i/v1/metrics')
    expect(metricIds).toHaveLength(2)
    expect(metricIds[0]).toEqual(expect.any(String))
    expect(metricIds[0]).not.toBe(metricIds[1])
    expect(ids('/i/v1/logs')).toEqual(metricIds)
    await Promise.all(clients.map((c) => c.shutdown()))
  })

  it('yields to one set in resourceAttributes', async () => {
    const client = new PostHog('TEST_API_KEY', {
      ...options,
      metrics: { serviceName: 'test-service', resourceAttributes: { 'service.instance.id': 'pod-7' } },
    })
    client.metrics.count('jobs.processed')
    await client.metrics.flush()
    expect(resourceAttr(JSON.parse(callsTo('/i/v1/metrics')[0][1].body), 'service.instance.id')).toBe('pod-7')
    await client.shutdown()
  })
})
