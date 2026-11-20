import type { Experiment } from '../../src/evaluations'
import { client, experimentResponse, ID, ITEM, mockFetch, reply, requestBody, requestURL, VERSION } from './helpers'

const RESULT = VERSION
const base = `/api/projects/123/ai_observability/offline_experiments/${ID}/`
const itemPath = `items/${ITEM}/`
const resultPath = `results/${RESULT}/`

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('corrects a result and its payload on a completed experiment using the revisions returned by the server', async () => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(reply(experimentResponse()))
    .mockResolvedValueOnce(reply(experimentResponse({ status: 'completed', finished_at: '2026-10-03T00:00:00Z' })))
    .mockResolvedValueOnce(reply({ id: RESULT, revision: 0, payload: null }))
    .mockResolvedValueOnce(reply({ revision: 0 }))
    .mockResolvedValueOnce(reply({ revision: 2 }))
  const experiment = await client().createExperiment({ id: ID, name: 'Run' })
  await experiment.complete()
  const revision = await experiment.getResultRevision(RESULT)
  const unchanged = await experiment.updateResult(RESULT, { revision, status: 'ok', value: false })
  expect(unchanged).toBe(0)
  await expect(
    experiment.updateResultPayload(RESULT, {
      revision: unchanged,
      payload: { reasoning: null, errorMessage: null, metadata: { reviewed: true } },
    })
  ).resolves.toBe(2)
  expect(fetch.mock.calls.slice(2).map(([url, init]) => [init.method, url.pathname])).toEqual([
    ['GET', base + resultPath + 'payload/'],
    ['PATCH', base + resultPath],
    ['PATCH', base + resultPath + 'payload/'],
  ])
  expect(requestBody(fetch, 3)).toEqual({ revision: 0, status: 'ok', value: false })
  expect(requestBody(fetch, 4)).toEqual({
    revision: 0,
    payload: { reasoning: null, error_message: null, metadata: { reviewed: true } },
  })
})

it('patches only supplied item and payload fields on a resumed handle', async () => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(reply({ id: ITEM, revision: 3 }))
    .mockResolvedValueOnce(reply({ revision: 4 }))
    .mockResolvedValueOnce(reply({ revision: 5 }))
  const experiment = client().resumeExperiment(ID)
  const revision = await experiment.getItemRevision(ITEM.toUpperCase())
  const corrected = await experiment.updateItem(ITEM, {
    revision,
    caseKey: null,
    modelVersion: 'v2',
    trial: undefined,
    applicationTraceId: 'trace',
  })
  await expect(
    experiment.updateItemPayload(ITEM, {
      revision: corrected,
      payload: { output: null, expectedOutput: false },
    })
  ).resolves.toBe(5)
  expect(fetch.mock.calls.map(([url, init]) => [init.method, url.pathname])).toEqual([
    ['GET', base + itemPath],
    ['PATCH', base + itemPath],
    ['PATCH', base + itemPath + 'payload/'],
  ])
  expect(requestBody(fetch, 1)).toEqual({
    revision: 3,
    case_key: null,
    model_version: 'v2',
    application_trace_id: 'trace',
  })
  expect(requestBody(fetch, 2)).toEqual({ revision: 4, payload: { output: null, expected_output: false } })
})

it.each([
  ['deleteItem', ITEM, itemPath],
  ['deleteItemPayload', ITEM, itemPath + 'payload/'],
  ['deleteResult', RESULT, resultPath],
  ['deleteResultPayload', RESULT, resultPath + 'payload/'],
] as const)('%s sends the revision in the query and accepts a 204 without a body', async (method, id, path) => {
  const fetch = mockFetch().mockResolvedValue(new Response(null, { status: 204 }))
  await expect(client().resumeExperiment(ID)[method](id, { revision: 0 })).resolves.toBeUndefined()
  expect(requestURL(fetch).pathname + requestURL(fetch).search).toBe(base + path + '?revision=0')
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'DELETE', body: undefined })
})

it.each([
  ['updateItemPayload', ITEM],
  ['updateResultPayload', RESULT],
] as const)('%s sends an explicitly empty payload', async (method, id) => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(reply({ revision: 4 }))
    .mockResolvedValueOnce(reply({ code: 'payload_unavailable' }, 409))
  const experiment = client().resumeExperiment(ID)

  await expect(experiment[method](id, { revision: 3, payload: {} })).resolves.toBe(4)
  await expect(experiment[method](id, { revision: 4, payload: {} })).rejects.toMatchObject({
    status: 409,
    code: 'payload_unavailable',
  })
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(requestBody(fetch, 0)).toEqual({ revision: 3, payload: {} })
  expect(requestBody(fetch, 1)).toEqual({ revision: 4, payload: {} })
})

it('uses the upload score encoding and leaves omitted outcome fields for the server to resolve', async () => {
  const fetch = mockFetch().mockImplementation(() => reply({ revision: 0 }))
  const experiment = client().resumeExperiment(ID)
  await experiment.updateResult(RESULT, { revision: 0, value: 2n ** 60n })
  await experiment.updateResult(RESULT, { revision: 0, value: ['z', 'a'] })
  await experiment.updateResult(RESULT, { revision: 0, errorCode: 'timeout' })
  await experiment.updateResult(RESULT, { revision: 0, status: 'skipped' })
  await experiment.updateResult(RESULT, { revision: 0, value: null, errorCode: null })
  expect(fetch.mock.calls[0][1].body).toContain('"value":1152921504606846976')
  expect(requestBody(fetch, 1)).toEqual({ revision: 0, value: ['a', 'z'] })
  expect(requestBody(fetch, 2)).toEqual({ revision: 0, error_code: 'timeout' })
  expect(requestBody(fetch, 3)).toEqual({ revision: 0, status: 'skipped' })
  expect(requestBody(fetch, 4)).toEqual({ revision: 0, value: null, error_code: null })
})

const update = (experiment: Experiment) => experiment.updateResult(RESULT, { revision: 2, value: 0 })
const remove = (experiment: Experiment) => experiment.deleteItem(ITEM, { revision: 2 })
describe.each([
  ['PATCH', update],
  ['DELETE', remove],
] as const)('%s', (_method, write) => {
  it.each([
    [409, 'revision_conflict', 'rejected'],
    [403, 'permission_denied', 'rejected'],
    [503, 'unavailable', 'unknown'],
  ])('surfaces HTTP %s without retrying or fetching a new revision', async (status, code, persistence) => {
    const fetch = mockFetch().mockImplementation(() => reply({ code }, status))
    await expect(write(client({ maxRetries: 2 }).resumeExperiment(ID))).rejects.toMatchObject({
      status,
      code,
      persistence,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('leaves persistence unknown after a lost response', async () => {
    const fetch = mockFetch().mockRejectedValue(new Error('lost response'))
    await expect(write(client({ maxRetries: 2 }).resumeExperiment(ID))).rejects.toMatchObject({
      code: 'transport_error',
      persistence: 'unknown',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

it('retries a revision read after a transient failure', async () => {
  vi.useFakeTimers()
  const fetch = mockFetch()
    .mockResolvedValueOnce(reply({}, 503))
    .mockResolvedValueOnce(reply({ id: RESULT, revision: 0 }))
  const pending = client({ maxRetries: 1 }).resumeExperiment(ID).getResultRevision(RESULT)
  await vi.runAllTimersAsync()
  await expect(pending).resolves.toBe(0)
  expect(fetch).toHaveBeenCalledTimes(2)
})

it.each<[string, (experiment: Experiment) => Promise<unknown>, Response]>([
  ['mismatched owner', (e) => e.getItemRevision(ITEM), reply({ id: RESULT, revision: 0 })],
  ['missing revision', (e) => e.getResultRevision(RESULT), reply({ id: RESULT })],
  ['boolean revision', update, reply({ revision: true })],
  ['older revision', update, reply({ revision: 1 })],
  ['empty PATCH response', update, new Response(null, { status: 204 })],
  ['unconfirmed DELETE', remove, reply({}, 202)],
])('reports %s as an invalid acknowledgment with unknown persistence', async (_case, operation, response) => {
  const fetch = mockFetch().mockResolvedValue(response)
  await expect(operation(client({ maxRetries: 2 }).resumeExperiment(ID))).rejects.toMatchObject({
    code: 'invalid_response',
    persistence: 'unknown',
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each<[string, (experiment: Experiment) => Promise<unknown>]>([
  ['invalid UUID', (e) => e.deleteResult('../items', { revision: 0 })],
  ['negative revision', (e) => e.deleteItemPayload(ITEM, { revision: -1 })],
  ['fractional revision', (e) => e.updateItem(ITEM, { revision: 0.5, trial: '2' })],
  ['boolean revision', (e) => e.deleteItem(ITEM, { revision: false } as never)],
  ['empty item change', (e) => e.updateItem(ITEM, { revision: 0 } as never)],
  ['undefined result change', (e) => e.updateResult(RESULT, { revision: 0, value: undefined } as never)],
  ['immutable item field', (e) => e.updateItem(ITEM, { revision: 0, datasetItemVersionId: ITEM } as never)],
  ['unknown result field', (e) => e.updateResult(RESULT, { revision: 0, calculate: true } as never)],
  ['unsafe score', (e) => e.updateResult(RESULT, { revision: 0, value: 9007199254740993n })],
  ['conflicting score', (e) => e.updateResult(RESULT, { revision: 0, status: 'error', value: false } as never)],
  ['invalid error code', (e) => e.updateResult(RESULT, { revision: 0, errorCode: 'x'.repeat(129) })],
  ['missing payload', (e) => e.updateItemPayload(ITEM, { revision: 0 } as never)],
  [
    'unsupported payload field',
    (e) => e.updateItemPayload(ITEM, { revision: 0, payload: { reasoning: 'no' } } as never),
  ],
  ['invalid payload value', (e) => e.updateResultPayload(RESULT, { revision: 0, payload: { reasoning: 2 } } as never)],
  [
    'oversized payload',
    (e) => e.updateResultPayload(RESULT, { revision: 0, payload: { reasoning: 'é'.repeat(128 * 1024) } }),
  ],
])('rejects %s before sending a request', async (_case, operation) => {
  const fetch = mockFetch()
  await expect(operation(client().resumeExperiment(ID))).rejects.toThrow(TypeError)
  expect(fetch).not.toHaveBeenCalled()
})

it('snapshots queued changes and honors cancellation before a write starts', async () => {
  const fetch = mockFetch().mockImplementation(() => reply({ revision: 1 }))
  const experiment = client().resumeExperiment(ID)
  const abort = new AbortController()
  const payload = { input: ['original'] }
  const first = experiment.updateItemPayload(ITEM, { revision: 0, payload })
  const second = experiment.deleteItem(ITEM, { revision: 1 }, { signal: abort.signal })
  payload.input.push('late')
  abort.abort()
  await expect(second).rejects.toBe(abort.signal.reason)
  await expect(first).resolves.toBe(1)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(requestBody(fetch)).toEqual({ revision: 0, payload: { input: ['original'] } })
})
