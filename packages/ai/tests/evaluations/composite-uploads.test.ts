import { randomUUID } from 'node:crypto'
import {
  BulkUploadError,
  EvaluationItem,
  EvaluationResult,
  type EvaluationResultOptions,
  type ResultStatus,
} from '../../src/evaluations'
import { bytes, type WireObject } from '../../src/evaluations/serialization'
import {
  client,
  ID,
  ITEM,
  VERSION,
  REVISION,
  experimentResponse,
  mockFetch,
  reply,
  requestBody,
  uploadResponse,
} from './helpers'

const reported = (item: EvaluationItem | string = new EvaluationItem(), scorerVersionId = VERSION) =>
  new EvaluationResult({ item, scorerVersionId, value: false })
const calculated = (item: EvaluationItem | string = ITEM) =>
  new EvaluationResult({ item, scorerVersionId: REVISION, calculate: true })
function acknowledgment(
  body: string,
  status: ResultStatus = 'ok',
  errorCode: string | null = null,
  created = true
): WireObject {
  const response = uploadResponse(body, created)
  for (const row of response.results as WireObject[]) {
    row.status = row.scorer_version_id === REVISION ? status : 'ok'
    row.error_code = row.scorer_version_id === REVISION ? errorCode : null
  }
  return response
}

afterEach(() => vi.unstubAllGlobals())

it('serializes and restores a calculation with stable identities and no reported fields', () => {
  const item = new EvaluationItem({ id: ITEM, output: 'answer', modelVersion: 'model-b' })
  const result = calculated(item)
  expect(result.toJSON()).toEqual({ item_id: ITEM, scorer_version_id: REVISION, calculate: true })
  const restored = EvaluationResult.fromJSON(JSON.parse(result.toJSONString()), {
    item: EvaluationItem.fromJSON(JSON.parse(item.toJSONString())),
  })
  expect(restored.calculate).toBe(true)
  expect(restored.toJSONString()).toBe(result.toJSONString())
  expect(restored.item).toBeInstanceOf(EvaluationItem)
  expect(Object.isFrozen(restored)).toBe(true)
  const snapshot = result.toJSON()
  snapshot.calculate = false
  expect(result.toJSON().calculate).toBe(true)
})

it('omits accepted default null arguments and the default status from calculations', () => {
  expect(
    new EvaluationResult({
      item: ITEM,
      scorerVersionId: REVISION,
      calculate: true,
      status: 'ok',
      value: null,
      errorCode: null,
      evaluatedAt: null,
      evaluatorTraceId: null,
    }).toJSON()
  ).toEqual(calculated().toJSON())
})

it.each([
  { value: false },
  { value: 0 },
  { value: [] },
  { status: 'error' },
  { status: null },
  { payload: {} },
  { payload: null },
  { reasoning: null },
  { metadata: null },
  { errorMessage: null },
  { errorCode: 'failure' },
  { evaluatorTraceId: 'trace' },
  { evaluatedAt: '2026-11-11T00:00:00Z' },
  { calculate: 'true' },
  { calculate: 1 },
  { calculate: null },
])('rejects invalid calculation declarations before I/O: %j', async (overrides) => {
  const fetch = mockFetch()
  await expect(
    client()
      .resumeExperiment(ID)
      .uploadResult({
        item: ITEM,
        scorerVersionId: REVISION,
        calculate: true,
        ...overrides,
      } as unknown as EvaluationResultOptions)
  ).rejects.toThrow(TypeError)
  expect(fetch).not.toHaveBeenCalled()
})

it('rejects conflicting reported fields when restoring a calculation', () => {
  expect(() => EvaluationResult.fromJSON({ ...calculated().toJSON(), value: false })).toThrow(TypeError)
  expect(() => EvaluationResult.fromJSON({ ...calculated().toJSON(), payload: {} })).toThrow(TypeError)
})

it.each([undefined, false])('preserves ordinary uploads and legacy receipts with calculate=%j', async (calculate) => {
  const fetch = mockFetch().mockImplementation((_url, init) => reply(uploadResponse(init.body)))
  const receipt = await client()
    .resumeExperiment(ID)
    .uploadResult({ item: ITEM, scorerVersionId: VERSION, value: false, calculate })
  expect(requestBody(fetch).results).toEqual([
    { item_id: ITEM, scorer_version_id: VERSION, status: 'ok', value: false },
  ])
  expect(receipt.results[0]).toMatchObject({ status: null, errorCode: null })
})

it.each([
  ['ok', null],
  ['skipped', null],
  ['not_applicable', null],
  ['error', 'composite_formula_error'],
  ['error', 'composite_input_error'],
] as const)('returns stored %s outcomes on initial upload and exact replay', async (status, errorCode) => {
  const fetch = mockFetch().mockImplementation((_url, init) => reply(acknowledgment(init.body, status, errorCode)))
  const run = client().resumeExperiment(ID)
  const results = [reported(ITEM), calculated()]
  const first = await run.uploadResults(results)
  expect(first.chunks[0].results[1]).toMatchObject({ status, errorCode, created: true })
  fetch.mockResolvedValueOnce(reply(experimentResponse({ status: 'completed', finished_at: '2026-11-11T00:00:00Z' })))
  await run.complete()
  fetch.mockImplementation((_url, init) => reply(acknowledgment(init.body, status, errorCode, false)))
  const retried = await run.uploadResults(results)
  expect(retried.chunks[0].results[1]).toMatchObject({ status, errorCode, created: false })
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[2][1].body)
})

it('supports single calculation uploads without dependency discovery', async () => {
  const fetch = mockFetch().mockImplementation((_url, init) => reply(acknowledgment(init.body)))
  await client().resumeExperiment(ID).uploadResult({ item: ITEM, scorerVersionId: REVISION, calculate: true })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(requestBody(fetch)).toEqual({ items: [], results: [calculated().toJSON()] })
})

it.each([
  {},
  { status: 'ok' },
  { error_code: null },
  { status: null, error_code: null },
  { status: 'unknown', error_code: null },
  { status: 'error', error_code: 123 },
  { status: 'error', error_code: '' },
  { status: 'error', error_code: 'x'.repeat(129) },
  { status: 'ok', error_code: 'unexpected' },
])('retains recoverable work for malformed calculated outcomes: %j', async (fields) => {
  const fetch = mockFetch().mockImplementation((_url, init) => {
    const data = uploadResponse(init.body)
    Object.assign((data.results as WireObject[])[0], fields)
    return reply(data)
  })
  const error = await client({ maxRetries: 3 })
    .resumeExperiment(ID)
    .uploadResults([calculated()])
    .catch((error) => error)
  expect(error).toBeInstanceOf(BulkUploadError)
  expect(error).toMatchObject({ code: 'invalid_response', persistence: 'unknown', failedIndex: 0 })
  expect(error.pendingResults[0].toJSON()).toEqual(calculated().toJSON())
  expect(error.failedChunk).toEqual(requestBody(fetch))
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('also rejects malformed outcome fields on reported acknowledgments', async () => {
  mockFetch().mockImplementation((_url, init) => {
    const response = uploadResponse(init.body)
    Object.assign((response.results as WireObject[])[0], { status: 'ok', error_code: 'bad' })
    return reply(response)
  })
  await expect(client().resumeExperiment(ID).uploadResults([reported()])).rejects.toMatchObject({
    code: 'invalid_response',
    persistence: 'unknown',
  })
})

it('keeps a calculation with its input at the result-count boundary', async () => {
  const fetch = mockFetch().mockImplementation((_url, init) => reply(acknowledgment(init.body)))
  const item = new EvaluationItem({ input: 'shared' })
  const results = [...Array.from({ length: 999 }, () => reported()), reported(item), calculated(item.id)]
  const receipt = await client().resumeExperiment(ID).uploadResults(results)
  expect(receipt.chunks.map((chunk) => chunk.results.length)).toEqual([999, 2])
  expect(requestBody(fetch, 1).items).toEqual([item.toJSON()])
  expect(fetch.mock.calls.flatMap(([, init]) => JSON.parse(init.body).results)).toEqual(
    results.map((result) => result.toJSON())
  )
})

it('merges overlapping item spans while preserving interleaved caller order', async () => {
  const fetch = mockFetch().mockImplementation((_url, init) => reply(acknowledgment(init.body)))
  const a = new EvaluationItem(),
    b = new EvaluationItem()
  const group = [reported(a), calculated(b), calculated(a), reported(b)]
  const receipt = await client()
    .resumeExperiment(ID)
    .uploadResults([...Array.from({ length: 998 }, () => reported()), ...group])
  expect(receipt.chunks.map((chunk) => chunk.results.length)).toEqual([998, 4])
  expect(requestBody(fetch, 1).results).toEqual(group.map((result) => result.toJSON()))
  expect(requestBody(fetch, 1).items).toEqual([a.toJSON(), b.toJSON()])
})

it('retains intervening ordinary results in a composite item span at the byte boundary', async () => {
  const fetch = mockFetch().mockImplementation((_url, init) => reply(acknowledgment(init.body)))
  const large = () => new EvaluationItem({ input: 'é'.repeat(450000) })
  const item = large()
  const group = [calculated(item.id), reported(large()), reported(item)]
  const results = [...Array.from({ length: 4 }, () => reported(large())), ...group]
  const receipt = await client().resumeExperiment(ID).uploadResults(results)
  expect(receipt.chunks.map((chunk) => chunk.results.length)).toEqual([4, 3])
  expect(requestBody(fetch, 1).results).toEqual(group.map((result) => result.toJSON()))
  for (const [, init] of fetch.mock.calls) expect(bytes(init.body)).toBeLessThanOrEqual(5 * 1024 * 1024)
})

it.each(['count', 'bytes'])('rejects oversized composite groups before sending any earlier work: %s', async (limit) => {
  const fetch = mockFetch(),
    item = new EvaluationItem()
  const group =
    limit === 'count'
      ? Array.from({ length: 1000 }, () => reported(item, randomUUID()))
      : Array.from(
          { length: 22 },
          () => new EvaluationResult({ item, scorerVersionId: randomUUID(), value: 1, reasoning: 'é'.repeat(125000) })
        )
  const results = [...Array.from({ length: 1000 }, () => reported()), ...group, calculated(item)]
  await expect(client().resumeExperiment(ID).uploadResults(results)).rejects.toThrow('group exceeds')
  expect(fetch).not.toHaveBeenCalled()
})

it('accepts a composite group of exactly 1000 results', async () => {
  const fetch = mockFetch().mockImplementation((_url, init) => reply(acknowledgment(init.body)))
  const item = new EvaluationItem()
  const results = [...Array.from({ length: 999 }, () => reported(item, randomUUID())), calculated(item)]
  const receipt = await client().resumeExperiment(ID).uploadResults(results)
  expect(receipt.chunks[0].results).toHaveLength(1000)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('replays the exact failed grouped request with original indices and all declarations', async () => {
  const fetch = mockFetch()
    .mockImplementationOnce((_url, init) => reply(acknowledgment(init.body)))
    .mockRejectedValueOnce(new Error('lost response'))
  const item = new EvaluationItem({ modelVersion: 'model-b', input: 'shared' })
  const group = [calculated(item.id), reported(item)]
  const results = [
    ...Array.from({ length: 999 }, () => reported()),
    ...group,
    ...Array.from({ length: 1000 }, () => reported()),
  ]
  const run = client().resumeExperiment(ID)
  const error = (await run.uploadResults(results).catch((error) => error)) as BulkUploadError
  expect(error).toBeInstanceOf(BulkUploadError)
  expect(error.failedIndex).toBe(999)
  expect(error.completed.chunks[0].results).toHaveLength(999)
  expect(error.pendingResults).toHaveLength(1002)
  expect(error.pendingResults[0].item).toBeInstanceOf(EvaluationItem)
  expect(error.failedChunk).toEqual(requestBody(fetch, 1))
  fetch.mockImplementation((_url, init) => reply(acknowledgment(init.body)))
  await run.uploadResults(error.pendingResults)
  expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[2][1].body)
  expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/upload/'))).toBe(true)
})
