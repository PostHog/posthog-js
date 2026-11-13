import type { ScorerComposition, CreateScorerOptions } from '../../src/evaluations'
import {
  client,
  ID,
  VERSION,
  REVISION,
  TIME,
  scorerResponse,
  mockFetch,
  reply,
  requestBody,
  requestURL,
  pageResponse,
} from './helpers'
import type { WireObject } from '../../src/evaluations/serialization'

const composition: ScorerComposition = {
  expression: 'quality * 2',
  inputs: [{ alias: 'quality', scorerVersionId: VERSION }],
}
const wireComposition = { expression: 'quality * 2', inputs: [{ alias: 'quality', scorer_version_id: VERSION }] }
const compositeResponse = (overrides: WireObject = {}) =>
  scorerResponse({
    calculation: 'composite',
    composition: wireComposition,
    input_scorers: [
      {
        alias: 'quality',
        scorer_version_id: VERSION,
        definition_id: ID,
        name: 'Quality',
        kind: 'numeric',
        version: 1,
        config: { min: 0, max: 1, passing_rule: { operator: 'gte', threshold: 0.5 } },
        latest_version_id: REVISION,
        latest_version: 2,
      },
    ],
    dependent_composite_count: 0,
    ...overrides,
  })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it('creates composites with pinned inputs and detached historical configuration', async () => {
  const fetch = mockFetch().mockResolvedValue(reply(compositeResponse()))
  const options = {
    name: 'Combined',
    kind: 'numeric' as const,
    calculation: 'composite' as const,
    config: { max: 2 },
    composition: structuredClone(composition),
  }
  const pending = client().scorers.create(options)
  options.composition.expression = 'changed'
  options.composition.inputs[0].scorerVersionId = REVISION
  const scorer = await pending
  expect(requestBody(fetch)).toEqual({
    name: 'Combined',
    kind: 'numeric',
    calculation: 'composite',
    config: { max: 2 },
    composition: wireComposition,
  })
  expect(scorer).toMatchObject({
    calculation: 'composite',
    composition,
    dependentCompositeCount: 0,
    inputScorers: [
      {
        scorerVersionId: VERSION,
        version: 1,
        latestVersionId: REVISION,
        latestVersion: 2,
        config: { passingRule: { operator: 'gte', threshold: 0.5 } },
      },
    ],
  })
  scorer.composition!.inputs[0].alias = 'changed'
  scorer.inputScorers[0].name = 'changed'
  expect(composition.inputs[0].alias).toBe('quality')
  expect(compositeResponse().input_scorers).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'Quality' })])
  )
})

it.each([
  { kind: 'boolean', config: { true_is_failure: true } },
  { kind: 'categorical', config: { options: [{ key: 'high', label: 'High' }], selection_mode: 'multiple' } },
])('reads $kind composites and pinned input config', async ({ kind, config }) => {
  const data = compositeResponse({ kind, config })
  ;(data.input_scorers as WireObject[])[0] = {
    ...(data.input_scorers as WireObject[])[0],
    kind,
    config,
    latest_version_id: null,
    latest_version: null,
  }
  mockFetch().mockResolvedValue(reply(data))
  const scorer = await client().scorers.get(ID)
  expect(scorer.kind).toBe(kind)
  expect(scorer.inputScorers[0]).toMatchObject({ kind, latestVersionId: null, latestVersion: null })
  if (scorer.kind === 'boolean') expect(scorer.config.trueIsFailure).toBe(true)
  if (scorer.inputScorers[0].kind === 'categorical')
    expect(scorer.inputScorers[0].config.selectionMode).toBe('multiple')
})

it('creates explicit versions and reads the original composition', async () => {
  const fetch = mockFetch()
    .mockResolvedValueOnce(reply(compositeResponse({ current_version: 2, current_version_id: REVISION })))
    .mockResolvedValueOnce(
      reply({
        id: VERSION,
        definition_id: ID,
        version: 1,
        kind: 'numeric',
        config: {},
        calculation: 'composite',
        composition: wireComposition,
        created_at: TIME,
        created_by: null,
      })
    )
  const scorers = client().scorers
  await scorers.createVersion(ID, { config: { max: 2 }, composition, baseVersion: 1 })
  expect(requestURL(fetch).pathname).toBe(`/api/projects/123/llm_analytics/score_definitions/${ID}/new_version/`)
  expect(requestBody(fetch)).toEqual({ config: { max: 2 }, composition: wireComposition, base_version: 1 })
  expect(await scorers.getVersion(ID, VERSION)).toMatchObject({ version: 1, calculation: 'composite', composition })
})

it('retains dependency, tag, and offset filters together', async () => {
  const fetch = mockFetch().mockResolvedValue(reply({ ...pageResponse([compositeResponse()]), count: 8 }))
  await client().scorers.list({
    calculation: 'composite',
    inputDefinitionId: ID,
    tags: ['quality'],
    tagMatch: 'all',
    offset: 7,
  })
  expect(Object.fromEntries(requestURL(fetch).searchParams)).toMatchObject({
    calculation: 'composite',
    input_definition_id: ID,
    tags: '["quality"]',
    tag_match: 'all',
    offset: '7',
  })
})

it('defaults older reported records without adding fields to ordinary create or version requests', async () => {
  const fetch = mockFetch().mockImplementation(() => reply(scorerResponse()))
  const scorers = client().scorers
  expect(
    await scorers.create({ name: 'Quality', kind: 'numeric', config: {}, calculation: 'reported', composition: null })
  ).toMatchObject({ calculation: 'reported', composition: null, inputScorers: [], dependentCompositeCount: 0 })
  expect(requestBody(fetch)).toEqual({ name: 'Quality', kind: 'numeric', config: {} })
  await scorers.createVersion(ID, { config: {}, composition: null })
  expect(requestBody(fetch, 1)).toEqual({ config: {} })
  fetch.mockResolvedValue(
    reply({
      id: VERSION,
      definition_id: ID,
      version: 1,
      kind: 'numeric',
      config: {},
      created_at: TIME,
      created_by: null,
    })
  )
  expect(await scorers.getVersion(ID, VERSION)).toMatchObject({ calculation: 'reported', composition: null })
})

it.each([undefined, {}])('validates without saving and preserves config omission: %j', async (config) => {
  const fetch = mockFetch().mockResolvedValue(reply({ valid: true }))
  expect(await client().scorers.validateComposition({ kind: 'numeric', composition, config })).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(requestURL(fetch).pathname).toBe('/api/projects/123/llm_analytics/score_definitions/validate_composition/')
  expect(requestBody(fetch)).toEqual({
    kind: 'numeric',
    composition: wireComposition,
    ...(config === undefined ? {} : { config }),
  })
})

it('uses safe retries only for read-scoped formula validation', async () => {
  vi.useFakeTimers()
  const fetch = mockFetch()
    .mockRejectedValueOnce(new Error('lost'))
    .mockResolvedValue(reply({ valid: true }))
  const pending = client({ maxRetries: 1 }).scorers.validateComposition({ kind: 'numeric', composition })
  await vi.runAllTimersAsync()
  expect(await pending).toBe(true)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body)
})

it.each(['create', 'version'] as const)('does not retry uncertain composite %s writes', async (operation) => {
  const fetch = mockFetch().mockRejectedValue(new Error('lost'))
  const scorers = client({ maxRetries: 3 }).scorers
  const pending =
    operation === 'create'
      ? scorers.create({ name: 'Combined', kind: 'numeric', config: {}, calculation: 'composite', composition })
      : scorers.createVersion(ID, { config: {}, composition })
  await expect(pending).rejects.toMatchObject({ persistence: 'unknown' })
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([400, 403])('preserves structured validation/access failures: %i', async (status) => {
  mockFetch().mockResolvedValue(
    reply({ code: 'validation_error', detail: { composition: ['Invalid input'] }, attr: 'composition' }, status)
  )
  await expect(client().scorers.validateComposition({ kind: 'numeric', composition })).rejects.toMatchObject({
    status,
    code: 'validation_error',
    attr: 'composition',
    detail: { composition: ['Invalid input'] },
  })
})

it.each([{}, { valid: false }, { valid: 'true' }])(
  'rejects malformed validation acknowledgments: %j',
  async (response) => {
    const fetch = mockFetch().mockResolvedValue(reply(response))
    await expect(
      client({ maxRetries: 3 }).scorers.validateComposition({ kind: 'numeric', composition })
    ).rejects.toMatchObject({ code: 'invalid_response', persistence: 'unknown' })
    expect(fetch).toHaveBeenCalledTimes(1)
  }
)

it.each([
  { calculation: 'unknown' },
  { calculation: null },
  { composition: null },
  { calculation: 'reported', composition: wireComposition },
  { composition: { ...wireComposition, inputs: [] } },
  { composition: { ...wireComposition, inputs: [{ alias: 'bad-name', scorer_version_id: VERSION }] } },
  { input_scorers: null },
  { input_scorers: [{}] },
  { dependent_composite_count: -1 },
])('rejects malformed composite metadata: %j', async (overrides) => {
  mockFetch().mockResolvedValue(reply(compositeResponse(overrides)))
  await expect(client().scorers.get(ID)).rejects.toMatchObject({ code: 'invalid_response' })
})

it.each([
  { expression: ' ' },
  { expression: 'x'.repeat(1025) },
  { inputs: [] },
  { inputs: Array.from({ length: 17 }, (_, i) => ({ alias: `x${i}`, scorerVersionId: VERSION })) },
  { inputs: [{ alias: 'Bad', scorerVersionId: VERSION }] },
  { inputs: [{ alias: 'quality\n', scorerVersionId: VERSION }] },
  { inputs: [{ alias: 'number', scorerVersionId: VERSION }] },
  { inputs: [{ alias: 'a'.repeat(33), scorerVersionId: VERSION }] },
  { inputs: [{ alias: 'quality', scorerVersionId: 'latest' }] },
  { inputs: [composition.inputs[0], composition.inputs[0]] },
  { inputs: new Array(1) },
])('rejects invalid compositions before I/O: %#', async (overrides) => {
  const fetch = mockFetch()
  const invalid = { ...composition, ...overrides }
  const scorers = client().scorers
  await expect(scorers.validateComposition({ kind: 'numeric', composition: invalid })).rejects.toThrow(TypeError)
  await expect(
    scorers.create({ name: 'Combined', kind: 'numeric', config: {}, calculation: 'composite', composition: invalid })
  ).rejects.toThrow(TypeError)
  await expect(scorers.createVersion(ID, { config: {}, composition: invalid })).rejects.toThrow(TypeError)
  expect(fetch).not.toHaveBeenCalled()
})

it('rejects calculation/composition mismatches, mutable modes, and numeric steps before I/O', async () => {
  const fetch = mockFetch(),
    scorers = client().scorers
  for (const options of [
    { calculation: 'composite' },
    { composition },
    { calculation: 'other', composition },
    { calculation: 'composite', composition, config: { step: 0.1 } },
  ]) {
    await expect(
      scorers.create({ name: 'Combined', kind: 'numeric', config: {}, ...options } as CreateScorerOptions)
    ).rejects.toThrow(TypeError)
  }
  await expect(scorers.createVersion(ID, { config: { step: 1 }, composition })).rejects.toThrow(TypeError)
  await expect(scorers.validateComposition({ kind: 'numeric', config: { step: 1 }, composition })).rejects.toThrow(
    TypeError
  )
  await expect(scorers.update(ID, { calculation: 'reported' } as never)).rejects.toThrow(TypeError)
  await expect(scorers.createVersion(ID, { config: {}, calculation: 'reported' } as never)).rejects.toThrow(TypeError)
  expect(fetch).not.toHaveBeenCalled()
})
