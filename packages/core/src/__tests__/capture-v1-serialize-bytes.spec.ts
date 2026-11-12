describe('capture v1 serialization without TextEncoder', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('loads and measures events on runtimes without TextEncoder', async () => {
    vi.stubGlobal('TextEncoder', undefined)
    vi.resetModules()

    const { serializeV1Event } = await import('@/capture-v1/serialize')
    const serialized = serializeV1Event({ event: 'e', distinct_id: 'd', uuid: '0198c0de-1234-7abc-8def-0123456789ab' })

    expect(serialized.bytes).toBe(Buffer.byteLength(serialized.json))
  })

  it.each([
    ['ascii', 'hello'],
    ['two-byte', 'é'],
    ['three-byte', '€'],
    ['surrogate pair', '🦔'],
    ['lone surrogate', 'a\uD800b'],
  ])('counts UTF-8 bytes for %s properties', async (_name, value) => {
    const { serializeV1Event } = await import('@/capture-v1/serialize')
    const serialized = serializeV1Event({
      event: 'e',
      distinct_id: 'd',
      uuid: '0198c0de-1234-7abc-8def-0123456789ab',
      properties: { value },
    })

    expect(serialized.bytes).toBe(Buffer.byteLength(serialized.json))
    const propertiesJson = serialized.json.slice(
      serialized.json.indexOf(',"properties":') + ',"properties":'.length,
      -1
    )
    expect(serialized.propertiesBytes).toBe(Buffer.byteLength(propertiesJson))
  })
})
