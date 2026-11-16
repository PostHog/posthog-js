import { randomUUID } from 'node:crypto'
import { EvaluationItem, EvaluationResult } from '../../src/evaluations'
import {
  client,
  DATASET,
  ID,
  ITEM,
  VERSION,
  REVISION,
  TIME,
  datasetResponse,
  itemResponse,
  scorerResponse,
  experimentResponse,
  mockFetch,
  pageResponse,
  reply,
  requestBody,
  requestURL,
  uploadResponse,
} from './helpers'
import { decode, type WireObject } from '../../src/evaluations/serialization'
const collect = async <T>(iterable: AsyncIterable<T>): Promise<T[]> => {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
}
afterEach(() => vi.unstubAllGlobals())

it.each(['only hole', 'leading hole', 'trailing hole'])(
  'rejects sparse tags before any management request: %s',
  async (shape) => {
    const fetch = mockFetch()
    const tags = new Array<string>(shape === 'only hole' ? 1 : 2)
    if (shape !== 'only hole') tags[shape === 'leading hole' ? 1 : 0] = 'keep'
    const evaluations = client()
    for (const request of [
      () => evaluations.resumeExperiment(ID).setTags(tags),
      () => evaluations.datasets.create({ name: 'Cases', tags }),
      () => evaluations.datasets.update(DATASET, { tags }),
      () => evaluations.datasets.list({ tags }),
      () => evaluations.scorers.create({ name: 'Quality', kind: 'boolean', config: {}, tags }),
      () => evaluations.scorers.update(ID, { tags }),
      () => evaluations.scorers.list({ tags }),
    ]) {
      await expect(request()).rejects.toThrow(TypeError)
    }
    expect(fetch).not.toHaveBeenCalled()
  }
)

describe('datasets: canonical contracts', () => {
  it('Metadata changes preserve revision state', async () => {
    const fetch = mockFetch().mockResolvedValue(
      reply(
        datasetResponse({
          metadata: {},
          description: 'preserved',
          current_revision: null,
          current_revision_id: null,
        })
      )
    )
    const value = await client().datasets.update(DATASET, { metadata: {} })
    expect(requestBody(fetch)).toEqual({ metadata: {} })
    expect(value).toMatchObject({
      description: 'preserved',
      currentRevision: null,
      currentRevisionId: null,
      metadata: {},
    })
  })
  it('Duplicate dataset names surface the server rejection', async () => {
    const fetch = mockFetch().mockResolvedValue(reply({ code: 'duplicate_name' }, 400))
    await expect(client().datasets.create({ name: 'Duplicate' })).rejects.toMatchObject({
      code: 'duplicate_name',
      persistence: 'rejected',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('JSON values retain their types', async () => {
    const fetch = mockFetch().mockResolvedValue(reply(itemResponse({ source_output: '' })))
    const item = await client().datasets.createItem(DATASET, { input: false, expectedOutput: 0, sourceOutput: '' })
    expect(requestBody(fetch)).toMatchObject({ input: false, expected_output: 0, source_output: '' })
    expect(item).toMatchObject({ input: false, expectedOutput: 0, sourceOutput: '' })
  })
  it.each([{ sourceTraceId: 'trace' }, { sourceTimestamp: TIME }, { sourceEventId: 'event' }])(
    'Incomplete provenance fails before a write: %#',
    async (provenance) => {
      const fetch = mockFetch()
      await expect(client().datasets.createItem(DATASET, { input: 'case', ...provenance })).rejects.toThrow()
      expect(fetch).not.toHaveBeenCalled()
    }
  )
  it('Updating an item preserves its historical version', async () => {
    const nextVersion = randomUUID()
    const fetch = mockFetch()
      .mockResolvedValueOnce(reply(itemResponse({ version: 3, version_id: nextVersion, expected_output: null })))
      .mockResolvedValueOnce(reply(itemResponse()))
    const datasets = client().datasets
    const updated = await datasets.updateItem(ITEM, { baseVersion: 2, expectedOutput: null })
    const old = await datasets.getItem(ITEM, { revision: 2 })
    expect(updated.id).toBe(old.id)
    expect(updated.versionId).not.toBe(old.versionId)
    expect(updated.expectedOutput).toBeNull()
    expect(old.expectedOutput).toBe(0)
    expect(requestBody(fetch)).toEqual({ base_version: 2, expected_output: null })
    expect(requestURL(fetch, 1).searchParams.get('revision')).toBe('2')
  })
  it('Identical content does not create history', async () => {
    mockFetch().mockResolvedValue(reply(itemResponse()))
    expect(await client().datasets.updateItem(ITEM, { baseVersion: 2, input: false })).toMatchObject({
      version: 2,
      datasetRevision: 2,
    })
  })
  it('A concurrent update is not overwritten', async () => {
    const fetch = mockFetch().mockResolvedValue(reply({ code: 'conflict', detail: { current_version: 3 } }, 409))
    await expect(
      client({ maxRetries: 3 }).datasets.updateItem(ITEM, { baseVersion: 2, input: 'new' })
    ).rejects.toMatchObject({ status: 409, detail: { current_version: 3 } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('Restore copies history into a new version', async () => {
    const fetch = mockFetch().mockResolvedValue(
      reply(itemResponse({ version: 4, input: 'historical', version_id: randomUUID() }))
    )
    const value = await client().datasets.restoreItem(ITEM, { baseVersion: 3, sourceVersion: 1 })
    expect(requestBody(fetch)).toEqual({ base_version: 3, source_version: 1 })
    expect(value).toMatchObject({ version: 4, input: 'historical', archived: false })
  })
  it('Restoring a dataset preserves archived items', async () => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(reply(datasetResponse()))
      .mockResolvedValueOnce(reply(pageResponse([])))
      .mockResolvedValueOnce(reply(pageResponse([itemResponse({ archived: true })])))
    const datasets = client().datasets
    await datasets.restore(DATASET)
    expect((await datasets.listItems(DATASET)).results).toEqual([])
    expect((await datasets.listItems(DATASET, { archived: true })).results[0].archived).toBe(true)
    expect(requestURL(fetch, 2).searchParams.get('archived')).toBe('true')
  })
  it('A keyed item create can recover a lost acknowledgment', async () => {
    vi.useFakeTimers()
    const fetch = mockFetch().mockRejectedValueOnce(new Error('lost')).mockResolvedValue(reply(itemResponse()))
    try {
      const pending = client({ maxRetries: 1 }).datasets.createItem(DATASET, {
        input: 'case',
        clientItemId: 'Case-A',
      })
      await vi.runAllTimersAsync()
      await pending
      expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body)
      expect(requestBody(fetch).client_item_id).toBe('Case-A')
    } finally {
      vi.useRealTimers()
    }
  })
  it('An unkeyed item create is not replayed', async () => {
    const fetch = mockFetch().mockRejectedValue(new Error('lost'))
    await expect(client({ maxRetries: 3 }).datasets.createItem(DATASET, { input: 'case' })).rejects.toMatchObject({
      persistence: 'unknown',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('Pagination preserves the original request scope', async () => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(reply(datasetResponse()))
      .mockResolvedValueOnce(reply(pageResponse([itemResponse()], 'https://evil.test/steal?offset=1&revision=4')))
      .mockResolvedValueOnce(reply(pageResponse([itemResponse({ id: randomUUID() })])))
    const snapshot = await client().datasets.snapshot(DATASET)
    await collect(snapshot)
    expect(requestURL(fetch, 2).origin).toBe('https://us.posthog.com')
    expect(Object.fromEntries(requestURL(fetch, 2).searchParams)).toMatchObject({
      dataset: DATASET,
      revision: '3',
      archived: 'false',
      offset: '1',
    })
  })
  it.each(['?offset=0', '?offset=abc', '?offset=1&offset=2', '?revision=3', '?offset=1.5'])(
    'Invalid continuation is observable: %s',
    async (next) => {
      mockFetch().mockResolvedValue(reply(pageResponse([itemResponse()], next)))
      await expect(client().datasets.listItems(DATASET)).rejects.toMatchObject({ code: 'invalid_response' })
    }
  )
  it('rejects empty pages with continuations', async () => {
    mockFetch().mockResolvedValue(reply(pageResponse([], '?offset=1')))
    await expect(client().datasets.listItems(DATASET)).rejects.toMatchObject({ code: 'invalid_response' })
  })
  it('Dataset changes do not move a snapshot', async () => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(reply(datasetResponse()))
      .mockImplementation(() => reply(pageResponse([itemResponse()])))
    const snapshot = await client().datasets.snapshot(DATASET)
    expect(fetch).toHaveBeenCalledTimes(1)
    snapshot.dataset.id = ID
    await collect(snapshot)
    await collect(snapshot.iterItems({ pageSize: 1 }))
    for (let i = 1; i < 3; i++) expect(requestURL(fetch, i).searchParams.get('revision')).toBe('3')
    expect(requestURL(fetch, 2).searchParams.get('offset')).toBe('0')
  })
  it('Historical resolution survives concurrent writes', async () => {
    const oldId = randomUUID()
    const rev = (revision: number, id = REVISION) => ({
      id,
      dataset_id: DATASET,
      revision,
      created_at: TIME,
      created_by: null,
      team_id: 123,
    })
    const fetch = mockFetch()
      .mockResolvedValueOnce(reply(datasetResponse()))
      .mockResolvedValueOnce(reply(pageResponse([rev(3)])))
      .mockResolvedValueOnce(reply(pageResponse([rev(4), rev(3)], '?offset=2')))
      .mockResolvedValueOnce(reply(pageResponse([rev(2, oldId)])))
    const snapshot = await client().datasets.snapshot(DATASET, { revision: 2 })
    expect(snapshot.revisionId).toBe(oldId)
    expect(fetch).toHaveBeenCalledTimes(4)
  })
  it('Empty history differs from an empty revision', async () => {
    mockFetch()
      .mockResolvedValueOnce(reply(datasetResponse({ current_revision: null, current_revision_id: null })))
      .mockResolvedValueOnce(reply(datasetResponse()))
      .mockResolvedValueOnce(reply(pageResponse([])))
    const datasets = client().datasets
    await expect(datasets.snapshot(DATASET)).rejects.toThrow('no revision')
    expect(await collect(await datasets.snapshot(DATASET))).toEqual([])
  })
  it('A partial read remains a failure', async () => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(reply(datasetResponse()))
      .mockResolvedValueOnce(reply(pageResponse([itemResponse()], '?offset=1')))
      .mockResolvedValueOnce(reply({}, 503))
      .mockResolvedValueOnce(reply(pageResponse([itemResponse()])))
    const snapshot = await client().datasets.snapshot(DATASET),
      iterator = snapshot.iterItems()
    expect((await iterator.next()).value.id).toBe(ITEM)
    await expect(iterator.next()).rejects.toMatchObject({ status: 503 })
    expect(await collect(snapshot)).toHaveLength(1)
    expect(requestURL(fetch, 3).searchParams.get('offset')).toBe('0')
  })
  it('A newer item cannot enter a pinned read', async () => {
    mockFetch().mockResolvedValue(reply(pageResponse([itemResponse({ dataset_revision: 4 })])))
    await expect(client().datasets.listItems(DATASET, { revision: 3 })).rejects.toMatchObject({
      code: 'invalid_response',
    })
  })
  it("Source data does not become a new execution's output", async () => {
    mockFetch().mockResolvedValue(reply(itemResponse()))
    const row = await client().datasets.getItem(ITEM)
    const first = EvaluationItem.fromDatasetItem(row, { output: 'new', applicationTraceId: 'new-trace' }),
      second = EvaluationItem.fromDatasetItem(row)
    expect(first.id).not.toBe(second.id)
    expect(first.toJSON()).toMatchObject({
      case_key: 'case-A',
      dataset_item_version_id: VERSION,
      application_trace_id: 'new-trace',
      payload: { input: false, expected_output: 0, output: 'new' },
    })
    expect(second.toJSON()).not.toHaveProperty('application_trace_id')
    expect(second.toJSON().payload).not.toHaveProperty('output')
    expect(() => EvaluationItem.fromDatasetItem({ ...row, archived: true })).toThrow()
  })
  it.each([{ team_id: 42 }, { dataset: ID }, { archived: true }, { input: null }, { version_id: 'invalid' }])(
    'rejects out-of-scope or malformed item %#',
    async (overrides) => {
      mockFetch().mockResolvedValue(reply(pageResponse([itemResponse(overrides)])))
      await expect(client().datasets.listItems(DATASET)).rejects.toMatchObject({ code: 'invalid_response' })
    }
  )
})

describe('scorers: canonical contracts', () => {
  it('Same-name scorers remain independent', async () => {
    const other = randomUUID()
    const fetch = mockFetch()
      .mockResolvedValueOnce(reply(scorerResponse()))
      .mockResolvedValueOnce(reply(scorerResponse({ id: other })))
    const scorers = client().scorers
    const a = await scorers.get(ID),
      b = await scorers.get(other)
    expect(a.name).toBe(b.name)
    expect(a.id).not.toBe(b.id)
    expect(requestURL(fetch, 1).pathname).toContain(other)
  })
  it('Failure polarity does not invert an uploaded value', async () => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(reply(scorerResponse({ kind: 'boolean', config: { true_is_failure: true } })))
      .mockImplementation((_url, init) => reply(uploadResponse(init.body)))
    const evaluations = client(),
      scorer = await evaluations.scorers.get(ID)
    await evaluations
      .resumeExperiment(ID)
      .uploadResult({ item: ITEM, scorerVersionId: scorer.currentVersionId, value: true })
    expect((requestBody(fetch, 1).results as WireObject[])[0]).toMatchObject({ status: 'ok', value: true })
    expect(scorer.config).toEqual({ trueIsFailure: true })
  })
  it('A zero numeric threshold and null bounds survive management', async () => {
    const config = { min: null, max: null, passing_rule: { operator: 'gte', threshold: 0 } }
    const fetch = mockFetch().mockResolvedValue(reply(scorerResponse({ config })))
    const result = await client().scorers.create({
      name: 'Quality',
      kind: 'numeric',
      config: { min: null, max: null, passingRule: { operator: 'gte', threshold: 0 } },
    })
    expect(requestBody(fetch).config).toEqual(config)
    expect(result.config.passingRule?.threshold).toBe(0)
  })
  it('An empty multiple-selection passing set is preserved', async () => {
    const config = {
      options: [{ key: 'safe', label: 'Safe' }],
      selection_mode: 'multiple',
      passing_rule: { categories: [] },
    }
    const fetch = mockFetch().mockResolvedValue(reply(scorerResponse({ kind: 'categorical', config })))
    const result = await client().scorers.create({
      name: 'Quality',
      kind: 'categorical',
      config: { options: config.options, selectionMode: 'multiple', passingRule: { categories: [] } },
    })
    expect(requestBody(fetch).config).toEqual(config)
    expect(result.config.passingRule?.categories).toEqual([])
  })
  it('Restoring and clearing metadata preserves the version', async () => {
    const fetch = mockFetch().mockResolvedValue(reply(scorerResponse()))
    const result = await client().scorers.update(ID, { archived: false, description: null, tags: [] })
    expect(requestBody(fetch)).toEqual({ archived: false, description: null, tags: [] })
    expect(result).toMatchObject({ currentVersion: 1, currentVersionId: VERSION, tags: [] })
  })
  it("A new version does not alter an existing result's configuration", async () => {
    const next = randomUUID()
    mockFetch()
      .mockResolvedValueOnce(
        reply(
          scorerResponse({
            kind: 'boolean',
            config: { true_is_failure: true },
            current_version: 2,
            current_version_id: next,
          })
        )
      )
      .mockResolvedValueOnce(
        reply({
          id: VERSION,
          definition_id: ID,
          version: 1,
          kind: 'boolean',
          config: { true_is_failure: false },
          created_at: TIME,
          created_by: null,
        })
      )
    const scorers = client().scorers
    expect((await scorers.createVersion(ID, { config: { trueIsFailure: true } })).currentVersionId).toBe(next)
    const original = await scorers.getVersion(ID, VERSION)
    expect(original.config).toEqual({ trueIsFailure: false })
  })
  it('Identical configuration can intentionally create a version', async () => {
    const fetch = mockFetch().mockResolvedValue(reply(scorerResponse({ current_version: 2 })))
    expect((await client().scorers.createVersion(ID, { config: { min: 0, max: 1 } })).currentVersion).toBe(2)
    expect(requestURL(fetch).pathname).toContain('/new_version/')
  })
  it('A stale version creation remains a conflict', async () => {
    const fetch = mockFetch().mockResolvedValue(reply({ code: 'conflict', detail: { current_version: 2 } }, 409))
    await expect(
      client({ maxRetries: 3 }).scorers.createVersion(ID, { config: {}, baseVersion: 1 })
    ).rejects.toMatchObject({ status: 409, detail: { current_version: 2 } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('A lost version acknowledgment does not create another version', async () => {
    const fetch = mockFetch().mockRejectedValue(new Error('lost'))
    await expect(client({ maxRetries: 3 }).scorers.createVersion(ID, { config: {} })).rejects.toMatchObject({
      persistence: 'unknown',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('Scorer listing retains its filters', async () => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(reply(pageResponse([scorerResponse()], 'https://evil.test/?offset=5&kind=boolean')))
      .mockResolvedValueOnce(reply(pageResponse([])))
    const scorers = client().scorers,
      filters = { kind: 'numeric' as const, archived: false, tags: ['regression'] }
    const first = await scorers.list(filters)
    await scorers.list({ ...filters, offset: first.nextOffset! })
    expect(requestURL(fetch, 1).origin).toBe('https://us.posthog.com')
    expect(Object.fromEntries(requestURL(fetch, 1).searchParams)).toMatchObject({
      kind: 'numeric',
      archived: 'false',
      tags: '["regression"]',
      offset: '5',
    })
  })
  it('Version history continues by cursor', async () => {
    const version = {
      id: VERSION,
      definition_id: ID,
      version: 1,
      kind: 'numeric',
      config: {},
      created_at: TIME,
      created_by: null,
    }
    const fetch = mockFetch()
      .mockResolvedValueOnce(reply({ count: 2, results: [version], next_cursor: 'opaque+/=' }))
      .mockResolvedValueOnce(reply({ count: 2, results: [version], next_cursor: null }))
    const scorers = client().scorers,
      first = await scorers.listVersions(ID)
    await scorers.listVersions(ID, { cursor: first.nextCursor! })
    expect(requestURL(fetch, 1).searchParams.get('cursor')).toBe('opaque+/=')
    expect(requestURL(fetch, 1).searchParams.has('offset')).toBe(false)
  })
  it('A malformed success is not an acknowledgment', async () => {
    const fetch = mockFetch().mockResolvedValue(reply(scorerResponse({ current_version_id: 'invalid' })))
    await expect(
      client({ maxRetries: 3 }).scorers.create({ name: 'Quality', kind: 'numeric', config: {} })
    ).rejects.toMatchObject({ code: 'invalid_response', persistence: 'unknown' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('detaches caller configuration and validates returned identity, tags, and kinds', async () => {
    const fetch = mockFetch().mockResolvedValue(reply(scorerResponse()))
    const config = { min: 0 }
    const pending = client().scorers.create({ name: 'Quality', kind: 'numeric', config })
    config.min = 99
    const value = await pending
    expect(requestBody(fetch).config).toEqual({ min: 0 })
    value.config.min = 100
    for (const overrides of [{ kind: 'unknown' }, { tags: [1] }, { team: 9 }, { id: ITEM }, { current_version: 0 }]) {
      fetch.mockResolvedValue(reply(scorerResponse(overrides)))
      await expect(client().scorers.get(ID)).rejects.toMatchObject({ code: 'invalid_response' })
    }
  })
})

it('One pinned dataset execution is scored twice', async () => {
  const otherVersion = randomUUID()
  const fetch = mockFetch()
    .mockResolvedValueOnce(reply(datasetResponse()))
    .mockResolvedValueOnce(reply(scorerResponse()))
    .mockResolvedValueOnce(reply(scorerResponse({ current_version_id: otherVersion })))
    .mockResolvedValueOnce(reply(experimentResponse()))
    .mockResolvedValueOnce(
      reply(pageResponse([itemResponse({ dataset_revision: 2, dataset_revision_id: randomUUID() })]))
    )
    .mockImplementation((_url, init) => reply(uploadResponse(init.body)))
  const evaluations = client(),
    snapshot = await evaluations.datasets.snapshot(DATASET)
  const a = await evaluations.scorers.get(ID),
    b = await evaluations.scorers.get(ID)
  const run = await evaluations.createExperiment({ name: 'Run', id: ID, datasetRevisionId: snapshot.revisionId })
  const [row] = await collect(snapshot)
  const item = EvaluationItem.fromDatasetItem(row, { output: 'new-output' })
  await run.uploadResults(
    [a, b].map((s) => new EvaluationResult({ item, scorerVersionId: s.currentVersionId, value: false }))
  )
  expect(requestBody(fetch, 3).dataset_revision_id).toBe(REVISION)
  const upload = requestBody(fetch, 5)
  expect(upload.items).toHaveLength(1)
  expect((upload.items as WireObject[])[0].dataset_item_version_id).toBe(VERSION)
  expect((upload.results as WireObject[]).map((r) => r.scorer_version_id)).toEqual([VERSION, otherVersion])
})
it('An item outside the pinned dataset revision is rejected', async () => {
  const fetch = mockFetch().mockResolvedValue(
    reply({ code: 'invalid_item_revision', errors: [{ attr: 'items.0.dataset_item_version_id' }] }, 400)
  )
  await expect(
    client()
      .resumeExperiment(ID)
      .uploadResults([
        new EvaluationResult({
          item: new EvaluationItem({ datasetItemVersionId: VERSION }),
          scorerVersionId: VERSION,
          value: false,
        }),
      ])
  ).rejects.toMatchObject({
    status: 400,
    code: 'invalid_item_revision',
    persistence: 'rejected',
    completed: { chunks: [] },
  })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('does not let caller mutation change the revision scope of an in-flight read', async () => {
  let respond!: (value: Response) => void
  mockFetch().mockImplementation(
    () =>
      new Promise((resolve) => {
        respond = resolve
      })
  )
  const options = { revision: 3 }
  const pending = client().datasets.getItem(ITEM, options)
  options.revision = 4
  respond(reply(itemResponse({ dataset_revision: 4 })))
  await expect(pending).rejects.toMatchObject({ code: 'invalid_response' })
})
it('preserves exactly representable large JSON integers and rejects precision loss in responses', async () => {
  const fetch = mockFetch().mockImplementation(
    () => new Response(JSON.stringify(itemResponse()).replace('"input":false', '"input":9007199254740992'))
  )
  expect((await client().datasets.getItem(ITEM)).input).toBe(9007199254740992)
  fetch.mockImplementation(
    () => new Response(JSON.stringify(itemResponse()).replace('"input":false', '"input":9007199254740993'))
  )
  await expect(client().datasets.getItem(ITEM)).rejects.toMatchObject({ code: 'invalid_response' })
})
it.each([1000000000000000128n, -1000000000000000128n, 2n ** 100n, -(2n ** 100n)])(
  'preserves the exact integer %s when creating and reading a dataset item',
  async (exact) => {
    const fetch = mockFetch().mockImplementation((_url, init) => {
      const { input } = decode(init.body) as WireObject
      return new Response(JSON.stringify(itemResponse()).replace('"input":false', `"input":${input}`))
    })
    const item = await client().datasets.createItem(DATASET, { input: Number(exact) })
    expect(fetch.mock.calls[0][1].body).toContain(`"input":${exact}`)
    expect(item.input).toBe(Number(exact))
  }
)
it.each([null, [1], 'tag'])('rejects malformed explicit tags instead of treating them as missing: %#', async (tags) => {
  mockFetch().mockImplementation(() => reply(datasetResponse({ tags })))
  await expect(client().datasets.get(DATASET)).rejects.toMatchObject({ code: 'invalid_response' })
})
it('rejects malformed typed scorer configuration fields', async () => {
  const fetch = mockFetch()
  for (const config of [
    { min: 'zero' },
    { passing_rule: { operator: 'unknown', threshold: 0 } },
    { passing_rule: { operator: 'gte', threshold: 'zero' } },
  ]) {
    fetch.mockImplementation(() => reply(scorerResponse({ config })))
    await expect(client().scorers.get(ID)).rejects.toMatchObject({ code: 'invalid_response' })
  }
})

it('rejects a creation receipt with a different scorer kind', async () => {
  mockFetch().mockImplementation(() => reply(scorerResponse({ kind: 'numeric' })))
  await expect(client().scorers.create({ name: 'Boolean', kind: 'boolean', config: {} })).rejects.toMatchObject({
    code: 'invalid_response',
  })
})
