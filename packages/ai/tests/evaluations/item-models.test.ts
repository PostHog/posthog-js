import { randomUUID } from 'node:crypto'
import { EvaluationItem, EvaluationResult, type EvaluationItemOptions } from '../../src/evaluations'
import {
  client,
  ID,
  ITEM,
  VERSION,
  experimentResponse,
  itemResponse,
  mockFetch,
  reply,
  requestBody,
  uploadResponse,
} from './helpers'

const result = (item: EvaluationItem | string, scorerVersionId = VERSION) =>
  new EvaluationResult({ item, scorerVersionId, value: false })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each(['', 42, false, {}, [], 'x'.repeat(256), '\u0000', '\ud800'])(
  'rejects invalid model identifiers before upload: %j',
  (modelVersion) => {
    const fetch = mockFetch()
    expect(() => new EvaluationItem({ modelVersion } as EvaluationItemOptions)).toThrow(TypeError)
    expect(() => EvaluationItem.fromJSON({ id: ITEM, model_version: modelVersion })).toThrow(TypeError)
    expect(fetch).not.toHaveBeenCalled()
  }
)

it.each(['x'.repeat(255), '😀'.repeat(255), ' model-b ', ' '])(
  'preserves valid model identifiers through serialization and upload: %j',
  async (modelVersion) => {
    const fetch = mockFetch().mockImplementation((_url, init) => reply(uploadResponse(init.body)))
    const item = EvaluationItem.fromJSON(JSON.parse(new EvaluationItem({ modelVersion }).toJSONString()))
    await client()
      .resumeExperiment(ID)
      .uploadResults([result(item)])
    expect(requestBody(fetch).items).toEqual([{ id: item.id, model_version: modelVersion }])
    expect(fetch).toHaveBeenCalledTimes(1)
  }
)

it.each(['model-a', undefined])(
  'uploads explicit and inherited models with experiment default %s',
  async (modelVersion) => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(reply(experimentResponse()))
      .mockImplementation((_url, init) => reply(uploadResponse(init.body)))
    const run = await client().createExperiment({ name: 'Models', id: ID, modelVersion })
    const items = ['model-b', 'model-c', undefined, null].map((modelVersion) => new EvaluationItem({ modelVersion }))
    const results = items.map((item) => result(item))
    await run.uploadResults(results)
    expect(requestBody(fetch, 0).model_version).toBe(modelVersion)
    expect(requestBody(fetch, 1)).toEqual({
      items: [
        { id: items[0].id, model_version: 'model-b' },
        { id: items[1].id, model_version: 'model-c' },
        { id: items[2].id },
        { id: items[3].id },
      ],
      results: results.map((r) => r.toJSON()),
    })
    for (const declaration of results) expect(declaration.toJSON()).not.toHaveProperty('model_version')
    expect(fetch).toHaveBeenCalledTimes(2)
  }
)

it('resumes without looking up explicit or inherited models and permits later scorer references', async () => {
  const fetch = mockFetch().mockImplementation((_url, init) => reply(uploadResponse(init.body)))
  const run = client().resumeExperiment(ID)
  const item = new EvaluationItem({ modelVersion: 'model-b' })
  const inherited = new EvaluationItem()
  await run.uploadResults([result(item), result(inherited)])
  expect(requestBody(fetch).items).toEqual([item.toJSON(), { id: inherited.id }])
  await run.uploadResults([result(item.id, randomUUID())])
  expect(requestBody(fetch, 1).items).toEqual([])
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls.every(([url]) => String(url).endsWith('/upload/'))).toBe(true)
})

it('restores a shared model and execution identity independently of detached saved declarations', () => {
  const item = new EvaluationItem({ modelVersion: 'model-b' })
  const original = [result(item), result(item, randomUUID())]
  const saved = item.toJSON()
  const restored = EvaluationItem.fromJSON(saved)
  const results = original.map((r) => EvaluationResult.fromJSON(r.toJSON(), { item: restored }))
  saved.model_version = 'model-c'
  expect(restored.toJSON()).toEqual({ id: item.id, model_version: 'model-b' })
  expect(item.toJSON()).toEqual(restored.toJSON())
  expect(results.every((r) => r.item === restored)).toBe(true)
  expect(results.map((r) => r.toJSON())).toEqual(original.map((r) => r.toJSON()))
})

it.each(['model-b', undefined, null])(
  'replays saved model %s without changing content or acknowledgment identities',
  async (modelVersion) => {
    let accepted: ReturnType<typeof uploadResponse> | undefined
    const fetch = mockFetch().mockImplementation((_url, init) => {
      if (!accepted) accepted = uploadResponse(init.body)
      else {
        for (const row of [
          ...(accepted.items as { created: boolean }[]),
          ...(accepted.results as { created: boolean }[]),
        ]) {
          row.created = false
        }
      }
      return reply(accepted)
    })
    const run = client().resumeExperiment(ID)
    // Omitted model_version represents a declaration saved before item models existed.
    const saved = { id: ITEM, ...(modelVersion === undefined ? {} : { model_version: modelVersion }) }
    const item = EvaluationItem.fromJSON(saved)
    const declaration = result(item)
    const first = await run.uploadResults([declaration])
    const restored = EvaluationItem.fromJSON(JSON.parse(item.toJSONString()))
    const second = await run.uploadResults([EvaluationResult.fromJSON(declaration.toJSON(), { item: restored })])
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body)
    expect(requestBody(fetch).items).toEqual([
      { id: ITEM, ...(modelVersion == null ? {} : { model_version: modelVersion }) },
    ])
    expect(second.chunks[0].items[0]).toEqual({ ...first.chunks[0].items[0], created: false })
    expect(second.chunks[0].results[0]).toEqual({ ...first.chunks[0].results[0], created: false })
  }
)

it.each([
  ['model-b', 'model-c'],
  ['model-b', undefined],
  [undefined, 'model-a'],
])('surfaces a backend content conflict when model %s becomes %s', async (before, after) => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(reply(experimentResponse()))
    .mockImplementationOnce((_url, init) => reply(uploadResponse(init.body)))
    .mockResolvedValueOnce(reply({ code: 'content_conflict', attr: 'items.0.model_version' }, 409))
  const run = await client().createExperiment({ name: 'Models', id: ID, modelVersion: 'model-a' })
  await run.uploadResults([result(new EvaluationItem({ id: ITEM, modelVersion: before }))])
  await expect(
    run.uploadResults([result(new EvaluationItem({ id: ITEM, modelVersion: after }))])
  ).rejects.toMatchObject({
    status: 409,
    code: 'content_conflict',
    attr: 'items.0.model_version',
    persistence: 'rejected',
  })
  expect(fetch).toHaveBeenCalledTimes(3)
})

it('rejects conflicting item models before sending any bulk chunks', async () => {
  const fetch = mockFetch()
  const item = new EvaluationItem({ id: ITEM, modelVersion: 'model-b' })
  const results = Array.from({ length: 1000 }, () => result(item, randomUUID()))
  results.push(result(new EvaluationItem({ id: ITEM, modelVersion: 'model-c' }), randomUUID()))
  await expect(client().resumeExperiment(ID).uploadResults(results)).rejects.toThrow('Conflicting item declarations')
  expect(fetch).not.toHaveBeenCalled()
})

it('retains the exact explicit model in automatic upload retries', async () => {
  vi.useFakeTimers()
  const fetch = mockFetch()
    .mockRejectedValueOnce(new Error('lost response'))
    .mockImplementation((_url, init) => reply(uploadResponse(init.body)))
  const item = new EvaluationItem({ modelVersion: 'model-b' })
  const pending = client({ maxRetries: 1 })
    .resumeExperiment(ID)
    .uploadResults([result(item)])
  await vi.runAllTimersAsync()
  await pending
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body)
  expect(requestBody(fetch).items).toEqual([{ id: item.id, model_version: 'model-b' }])
})

it('converts one dataset case into independent model executions without inferring its model from metadata', async () => {
  const metadata = { model_version: 'source-model' }
  const fetch = mockFetch()
    .mockResolvedValueOnce(reply(itemResponse({ metadata })))
    .mockImplementation((_url, init) => reply(uploadResponse(init.body)))
  const evaluations = client()
  const row = await evaluations.datasets.getItem(ITEM)
  const items = ['model-b', 'model-c', undefined, null].map((modelVersion, i) => {
    const item = EvaluationItem.fromDatasetItem(row, { modelVersion, output: `output-${i}` })
    expect(item.toJSON()).toMatchObject({
      case_key: 'case-A',
      dataset_item_identifier: ITEM,
      dataset_item_version_id: VERSION,
      dataset_item_version_identifier: VERSION,
      payload: { input: false, expected_output: 0, metadata, output: `output-${i}` },
    })
    expect(item.toJSON().model_version).toBe(modelVersion ?? undefined)
    return EvaluationItem.fromJSON(JSON.parse(item.toJSONString()))
  })
  expect(new Set(items.map((item) => item.id)).size).toBe(4)
  await evaluations.resumeExperiment(ID).uploadResults(items.map((item) => result(item)))
  expect(requestBody(fetch, 1).items).toEqual(items.map((item) => item.toJSON()))
  expect(() => EvaluationItem.fromDatasetItem(row, { modelVersion: '' })).toThrow(TypeError)
  expect(fetch).toHaveBeenCalledTimes(2)
})
