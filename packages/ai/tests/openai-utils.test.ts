import { extractRequestId, buildProviderMetadata } from '../src/openai/utils'

describe('extractRequestId', () => {
  it('reads `_request_id` from a response object', () => {
    expect(extractRequestId({ _request_id: 'req_abc123' })).toBe('req_abc123')
  })

  it('returns undefined when `_request_id` is absent', () => {
    expect(extractRequestId({ id: 'chatcmpl-1' })).toBeUndefined()
  })

  it.each([[null], [undefined], ['not-an-object'], [42]])('returns undefined for non-object input %p', (input) => {
    expect(extractRequestId(input)).toBeUndefined()
  })

  it('returns undefined when `_request_id` is null', () => {
    expect(extractRequestId({ _request_id: null })).toBeUndefined()
  })
})

describe('buildProviderMetadata', () => {
  it('includes both keys when present', () => {
    expect(buildProviderMetadata({ systemFingerprint: 'fp_1', requestId: 'req_1' })).toEqual({
      system_fingerprint: 'fp_1',
      request_id: 'req_1',
    })
  })

  it('omits keys whose value is missing', () => {
    expect(buildProviderMetadata({ systemFingerprint: 'fp_1' })).toEqual({ system_fingerprint: 'fp_1' })
    expect(buildProviderMetadata({ requestId: 'req_1' })).toEqual({ request_id: 'req_1' })
  })

  it('returns undefined when there is nothing to report', () => {
    expect(buildProviderMetadata({})).toBeUndefined()
    expect(buildProviderMetadata({ systemFingerprint: undefined, requestId: undefined })).toBeUndefined()
    expect(buildProviderMetadata({ systemFingerprint: null, requestId: null })).toBeUndefined()
  })
})
