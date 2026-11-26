import { RemoteConfigPayloadError } from '@/entrypoints/index.edge'

describe('RemoteConfigPayloadError from the edge entrypoint', () => {
  it('is exported with the flag key and status code', () => {
    const error = new RemoteConfigPayloadError('test-flag', 404)
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ name: 'RemoteConfigPayloadError', flagKey: 'test-flag', statusCode: 404 })
  })
})
