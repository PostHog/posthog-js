import { extractRequestId, buildProviderMetadata } from '../src/openai/utils'

describe('extractRequestId', () => {
  it.each<[name: string, input: unknown, expected: string | undefined]>([
    ['reads `_request_id` when present', { _request_id: 'req_abc123' }, 'req_abc123'],
    ['returns undefined when `_request_id` is absent', { id: 'chatcmpl-1' }, undefined],
    ['returns undefined when `_request_id` is null', { _request_id: null }, undefined],
    ['returns undefined for null input', null, undefined],
    ['returns undefined for undefined input', undefined, undefined],
    ['returns undefined for string input', 'not-an-object', undefined],
    ['returns undefined for numeric input', 42, undefined],
  ])('%s', (_name, input, expected) => {
    expect(extractRequestId(input)).toBe(expected)
  })
})

describe('buildProviderMetadata', () => {
  it.each<
    [
      name: string,
      input: Parameters<typeof buildProviderMetadata>[0],
      expected: ReturnType<typeof buildProviderMetadata>,
    ]
  >([
    [
      'includes both keys when both values are present',
      { systemFingerprint: 'fp_1', requestId: 'req_1' },
      { system_fingerprint: 'fp_1', request_id: 'req_1' },
    ],
    [
      'omits requestId when only systemFingerprint is present',
      { systemFingerprint: 'fp_1' },
      { system_fingerprint: 'fp_1' },
    ],
    ['omits systemFingerprint when only requestId is present', { requestId: 'req_1' }, { request_id: 'req_1' }],
    ['returns undefined for an empty input object', {}, undefined],
    [
      'returns undefined when both values are undefined',
      { systemFingerprint: undefined, requestId: undefined },
      undefined,
    ],
    ['returns undefined when both values are null', { systemFingerprint: null, requestId: null }, undefined],
  ])('%s', (_name, input, expected) => {
    expect(buildProviderMetadata(input)).toEqual(expected)
  })
})
