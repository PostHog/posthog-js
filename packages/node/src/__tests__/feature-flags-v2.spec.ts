import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020'

import * as v2 from '@/extensions/feature-flags/feature-flags-v2'

// The evaluator for config version 2 flags, replayed against the evaluation corpora.
//
// The corpora, the local outcome mapping and the hash vectors in `fixtures/feature_flag_rules_v2`
// are copied unchanged from a PostHog/posthog-sdk-test-harness contract; `SOURCE.json` records
// which. Each corpus case gives a configuration, a person and the exact expected result, and
// `local_outcomes.json` says what a local evaluator does with it.

const FIXTURES = fileURLToPath(new URL('./fixtures/feature_flag_rules_v2/', import.meta.url))
const load = (name: string): any => JSON.parse(readFileSync(FIXTURES + name, 'utf8'))

const BOOLEAN_CORPUS = 'v2_boolean_evaluation.json'
const VALUE_CORPUS = 'v2_value_evaluation.json'
const EXPERIMENT_CORPUS = 'v2_experiment_evaluation.json'
const LOCAL_CORPUS = 'v2_local_evaluation.json'
const CORPORA = [BOOLEAN_CORPUS, VALUE_CORPUS, EXPERIMENT_CORPUS, LOCAL_CORPUS]
const HASH_VECTORS = load('hash_sha1_60_v1.json')
// The local outcome of a case, by the status and the error or parse error kind of its expected
// result: conclusive, inconclusive with an unresolved reason, or not applicable.
const LOCAL_OUTCOMES = load('local_outcomes.json')

// A `not_applicable` case describes the remote request boundary: the flags service leaves an
// inactive, deleted or unrequested flag out of its response before it evaluates anything. The
// evaluator has no such boundary, so these cases are skipped.
const NOT_APPLICABLE = 'not_applicable'

// Cases this evaluator leaves to the flags service although the corpus has a result, with the
// reason. Each one falls back instead of answering.
const FALLS_BACK: Record<string, string> = {
  // The filter value is the JSON number 7. JavaScript reads `7` and `7.0` as one number, and the
  // flags service compares their text, which differs, so the filter is undecided here.
  'v2_boolean.property.exact_scalar': 'unsupported_definition',
}

type Case = Record<string, any>

/** Each case of a corpus, with the corpus defaults for its flag and context applied. */
function corpusCases(name: string): Case[] {
  const corpus = load(name)
  const defaults = corpus.defaults ?? {}
  return corpus.cases.map((testCase: Case) => ({
    ...testCase,
    corpus: name,
    flag: testCase.flag ?? defaults.flag,
    context: { ...defaults.context, ...testCase.context },
  }))
}

/** The row of the local outcome mapping for a case's expected result. */
function localOutcome(expected: Case): Case {
  const rows = LOCAL_OUTCOMES.rows.filter(
    (row: Case) => row.status === expected.status && row.error === expected.error && row.kind === expected.kind
  )
  expect(rows).toHaveLength(1)
  return rows[0]
}

const CASES: Case[] = CORPORA.flatMap(corpusCases)
const REPLAYED = CASES.filter((testCase) => localOutcome(testCase.expected).local_evaluation !== NOT_APPLICABLE)
const SKIPPED = CASES.filter((testCase) => localOutcome(testCase.expected).local_evaluation === NOT_APPLICABLE)

function binary64(hexadecimal: string): number {
  return new DataView(Uint8Array.from(Buffer.from(hexadecimal, 'hex')).buffer).getFloat64(0)
}

function binary64Hex(value: number): string {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, value)
  return Buffer.from(view.buffer).toString('hex')
}

function contextOf(raw: Case): v2.ConfigV2Context {
  return {
    identifier: raw.identifier,
    properties: raw.properties,
    propertiesComplete: raw.properties_complete,
    explicitExactMatching: raw.explicit_exact_matching,
    timeZone: raw.timezone,
    now: new Date(raw.now),
  }
}

/** Equality of JSON values by type as well as value: `1` is not `true`. */
function sameJson(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJson(item, right[index]))
    )
  }
  if (typeof left === 'object' && left !== null && typeof right === 'object' && right !== null) {
    const leftKeys = Object.keys(left).sort()
    const rightKeys = Object.keys(right).sort()
    return sameJson(leftKeys, rightKeys) && leftKeys.every((key) => sameJson((left as Case)[key], (right as Case)[key]))
  }
  return left === right
}

/** An outcome in the shape of a corpus `expected` member, which is exhaustive. */
function asExpectation(outcome: v2.ConfigV2Outcome): Case {
  switch (outcome.outcome) {
    case 'evaluated': {
      const expectation: Case = { status: 'success', value: outcome.value, reason: outcome.reason }
      const rule = { id: outcome.ruleId, rule_type: outcome.ruleType, index: outcome.ruleIndex }
      if (Object.values(rule).some((field) => field !== undefined)) {
        expectation.rule = rule
      }
      if (outcome.variantKey !== undefined) {
        expectation.variant = outcome.variantKey
      }
      return expectation
    }
    case 'unsupported':
      return { status: 'parse_error', kind: outcome.kind }
    case 'inconclusive':
      return { status: 'error', error: outcome.reason }
    case 'error':
      return { status: 'error', error: outcome.kind }
  }
}

type Drawn = [use: string, input: string, hash: string]

/** Evaluates a case. Returns the outcome and each hash drawn as [use, input, hash]. */
async function replay(testCase: Case): Promise<{ outcome: v2.ConfigV2Outcome; drawn: Drawn[] }> {
  const drawn: Drawn[] = []
  const replaced: string | undefined = testCase.white_box?.hash01_binary64_hex

  const draw = async (use: v2.HashUse, seed: string, subject: string): Promise<number> => {
    if (replaced !== undefined) {
      return binary64(replaced)
    }
    const prefix = use === 'holdout' ? seed : `${seed}.`
    const salt = use === 'variant' ? 'variant' : ''
    const hash = await v2.hash01(prefix, subject, salt)
    drawn.push([use, prefix + subject + salt, binary64Hex(hash)])
    return hash
  }

  // The parser must not change the document it reads.
  const document = structuredClone(testCase.config)
  const config = v2.parseConfigV2(document)
  expect(document).toEqual(testCase.config)
  const options = { active: testCase.flag.active }
  const outcome = await v2.evaluateConfigV2WithHash(config, contextOf(testCase.context), draw, options)
  if (replaced === undefined) {
    // The hash seam and the evaluator's own hash agree.
    expect(await v2.evaluateConfigV2(config, contextOf(testCase.context), options)).toEqual(outcome)
  }
  return { outcome, drawn }
}

describe('the config version 2 evaluator', () => {
  describe('replays the corpora', () => {
    it.each(REPLAYED.map((testCase) => [testCase.id, testCase]))('%s', async (_id, testCase) => {
      const expected = testCase.expected
      const { outcome, drawn } = await replay(testCase)

      if (testCase.id in FALLS_BACK) {
        expect(outcome).toMatchObject({ outcome: 'inconclusive', reason: FALLS_BACK[testCase.id] })
        return
      }
      expect(sameJson(asExpectation(outcome), expected)).toBe(true)
      const local = localOutcome(expected)
      if (local.local_evaluation === 'conclusive') {
        expect(outcome.outcome).toBe('evaluated')
      } else {
        expect(local.local_evaluation).toBe('inconclusive')
        expect(outcome.outcome).not.toBe('evaluated')
        // The evaluator names the reason of an inconclusive outcome. It leaves the reason of a
        // rejected document or an evaluation error to its caller.
        if (outcome.outcome === 'inconclusive') {
          expect(outcome.reason).toBe(local.unresolved_reason)
        }
      }

      const evidence = testCase.hash_evidence
      if (Array.isArray(evidence)) {
        // The experiment corpus lists every hash an evaluation draws, in draw order.
        expect(drawn).toEqual(
          evidence.map((entry: Case) => [
            entry.use,
            entry.prefix + entry.identifier + entry.salt,
            entry.hash01_binary64_hex,
          ])
        )
      } else if (evidence !== undefined && drawn.length > 0) {
        // The boolean corpus records one rollout hash, also for a case that draws none.
        expect(drawn).toEqual([
          ['rollout', Buffer.from(evidence.input_utf8_hex, 'hex').toString('utf8'), evidence.hash01_binary64_hex],
        ])
      }
    })

    it.skip.each(SKIPPED.map((testCase) => [testCase.id]))(
      '%s is about the remote request boundary, not the evaluator',
      () => {}
    )
  })

  it('compares every rule field', () => {
    // A result without a rule matches an expectation without a `rule` member only when it has none
    // of the three rule fields.
    const expected = { status: 'success', value: false, reason: 'no_rule_match' }
    const evaluated = (fields: Partial<v2.ConfigV2Evaluated> = {}): v2.ConfigV2Evaluated => ({
      outcome: 'evaluated',
      value: false,
      reason: 'no_rule_match',
      ...fields,
    })

    expect(sameJson(asExpectation(evaluated()), expected)).toBe(true)
    expect(sameJson(asExpectation(evaluated({ ruleType: 'targeted_release' })), expected)).toBe(false)
    expect(sameJson(asExpectation(evaluated({ ruleIndex: 0 })), expected)).toBe(false)
  })

  it('replays every corpus case the local outcome mapping covers', () => {
    const files = load('SOURCE.json').files
    expect(CORPORA.map((name) => files[name].source_path)).toEqual(LOCAL_OUTCOMES.corpora)

    const count = (keys: string[]): Record<string, number> =>
      keys.reduce<Record<string, number>>((counts, key) => ((counts[key] = (counts[key] ?? 0) + 1), counts), {})

    expect(count(CASES.map((testCase) => `${testCase.corpus} ${testCase.expected.status}`))).toEqual({
      [`${BOOLEAN_CORPUS} success`]: 121,
      [`${BOOLEAN_CORPUS} error`]: 9,
      [`${BOOLEAN_CORPUS} parse_error`]: 2,
      [`${BOOLEAN_CORPUS} omitted`]: 3,
      [`${VALUE_CORPUS} success`]: 38,
      [`${VALUE_CORPUS} parse_error`]: 11,
      [`${EXPERIMENT_CORPUS} success`]: 60,
      [`${EXPERIMENT_CORPUS} parse_error`]: 13,
      [`${LOCAL_CORPUS} success`]: 7,
      [`${LOCAL_CORPUS} error`]: 1,
    })
    expect(
      count(
        CASES.map((testCase) => {
          const row = localOutcome(testCase.expected)
          return `${row.local_evaluation} ${row.unresolved_reason ?? ''}`.trim()
        })
      )
    ).toEqual({
      conclusive: 226,
      'inconclusive missing_context': 7,
      'inconclusive unsupported_definition': 29,
      [NOT_APPLICABLE]: 3,
    })
    expect(SKIPPED.map((testCase) => testCase.id).sort()).toEqual([
      'v2_boolean.eligibility.deleted',
      'v2_boolean.eligibility.inactive',
      'v2_boolean.eligibility.request_filtered',
    ])
    expect(Object.keys(FALLS_BACK).every((id) => REPLAYED.some((testCase) => testCase.id === id))).toBe(true)
    expect(count(REPLAYED.map((testCase) => `${testCase.corpus} ${testCase.family}`))).toEqual({
      [`${BOOLEAN_CORPUS} ordering`]: 18,
      [`${BOOLEAN_CORPUS} properties`]: 67,
      [`${BOOLEAN_CORPUS} context`]: 8,
      [`${BOOLEAN_CORPUS} errors`]: 6,
      [`${BOOLEAN_CORPUS} hashing`]: 21,
      [`${BOOLEAN_CORPUS} white_box`]: 10,
      [`${BOOLEAN_CORPUS} parser`]: 2,
      [`${VALUE_CORPUS} ordering`]: 27,
      [`${VALUE_CORPUS} values`]: 11,
      [`${VALUE_CORPUS} parser`]: 11,
      [`${EXPERIMENT_CORPUS} ordering`]: 20,
      [`${EXPERIMENT_CORPUS} assignment`]: 21,
      [`${EXPERIMENT_CORPUS} values`]: 9,
      [`${EXPERIMENT_CORPUS} white_box`]: 10,
      [`${EXPERIMENT_CORPUS} parser`]: 13,
      [`${LOCAL_CORPUS} flag_disabled`]: 6,
      [`${LOCAL_CORPUS} context`]: 2,
    })
  })

  // The local evaluation files of the contract and the schema of each. The definitions feed
  // fixture is the dispatch's test input; its schema refers to the local corpus schema by ID.
  const LOCAL_EVALUATION_SCHEMAS: Record<string, string> = {
    'local_outcomes.json': 'local_outcomes.schema.json',
    [LOCAL_CORPUS]: 'v2_local_evaluation.schema.json',
    'definitions_feed.json': 'definitions_feed_fixture.schema.json',
  }

  it.each(Object.keys(LOCAL_EVALUATION_SCHEMAS))('%s matches its schema', (name) => {
    const ajv = new Ajv2020({ strict: false, allErrors: true })
    ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    ajv.addFormat('date-time', (value: string) => !Number.isNaN(Date.parse(value)))
    for (const schema of Object.values(LOCAL_EVALUATION_SCHEMAS)) {
      ajv.addSchema(load(schema))
    }
    const validate = ajv.getSchema(load(LOCAL_EVALUATION_SCHEMAS[name]).$id)!

    expect(validate(load(name))).toBe(true)
  })

  describe('hash vectors', () => {
    const variants = (raw: Case[]): { key: string; weight: number }[] =>
      // The vectors name a variant's weight `rollout_percentage`, as version 1 does.
      raw.map((variant) => ({ key: variant.key, weight: variant.rollout_percentage }))

    it.each(HASH_VECTORS.vectors.map((vector: Case) => [vector.id, vector]))(
      '%s gives its exact binary64 hash',
      async (_id, vector) => {
        // The JSON reader must round the decimal literal correctly, or a boundary case moves.
        expect(binary64Hex(vector.hash01)).toBe(vector.hash01_binary64_hex)

        const hash = await v2.hash01(vector.prefix, vector.identifier, vector.salt)

        expect(binary64Hex(hash)).toBe(vector.hash01_binary64_hex)
        if ('identifier_before_truncation' in vector) {
          expect(v2.truncateIdentifier(vector.identifier_before_truncation)).toBe(vector.identifier)
        }
        for (const check of vector.rollout_checks ?? []) {
          expect(await v2.inRollout(check.rollout_percentage, () => hash)).toBe(check.included)
        }
        for (const check of vector.holdout_checks ?? []) {
          expect(await v2.inRollout(check.exclusion_percentage, () => hash)).toBe(check.member)
        }
        if ('variant_check' in vector) {
          const selected = v2.selectVariant(hash, variants(vector.variant_check.variants))
          expect(selected.key).toBe(vector.variant_check.selected)
        }
      }
    )

    it.each(HASH_VECTORS.threshold_vectors.map((vector: Case) => [vector.id, vector]))(
      '%s is included as stated',
      async (_id, vector) => {
        const draw = (): number => {
          expect(vector.short_circuit).toBeFalsy()
          return vector.hash01
        }

        expect(await v2.inRollout(vector.rollout_percentage, draw)).toBe(vector.included)
      }
    )

    it.each(HASH_VECTORS.variant_vectors.map((vector: Case) => [vector.id, vector]))(
      '%s selects the stated variant',
      (_id, vector) => {
        const selected = v2.selectVariant(vector.hash01, variants(vector.variants))

        // Past the last boundary version 1 selects nothing, and version 2 the last variant.
        expect(selected.key).toBe(vector.v2_selected ?? vector.selected)
      }
    )

    it.each(
      HASH_VECTORS.seed_parity.filter((parity: Case) => 'v2' in parity).map((parity: Case) => [parity.id, parity])
    )('%s: a seed equal to the flag key hashes the version 1 input', async (_id, parity) => {
      const seeded = parity.v2

      const hash = await v2.hash01(seeded.prefix, seeded.identifier, seeded.salt)

      expect(seeded.prefix + seeded.identifier + seeded.salt).toBe(seeded.input)
      expect(hash).toBe(parity.hash01)
      expect(seeded.input === parity.v1_input).toBe(parity.identical_bytes)
    })
  })
})

// --- What the corpora do not cover -------------------------------------------------------------

const RULE_ID = '7f3c2a10-8d4e-4b6a-9c21-5e0f1a2b3c4d'
const OTHER_RULE_ID = '2b9d4e61-0c7a-4f35-8e12-6a4b3c2d1e0f'
const NOW = new Date('2025-06-15T12:00:00Z')
const OSLO = 'Europe/Oslo'

const targeted = (properties: Case[] = [], fields: Case = {}): Case => ({
  id: RULE_ID,
  rule_type: 'targeted_release',
  targeting: { properties },
  value: true,
  ...fields,
})

const experiment = (fields: Case = {}): Case => ({
  id: RULE_ID,
  rule_type: 'experiment',
  targeting: { properties: [] },
  paused: false,
  rollout_percentage: 100,
  on_rollout_miss: 'continue',
  assignment_algorithm: 'sha1_60_v1',
  seed: 'layout-test',
  variants: [
    { key: 'control', weight: 50, value: false },
    { key: 'test', weight: 50, value: true },
  ],
  ...fields,
})

const filters = (rules: Case[], fields: Case = {}): Case => ({
  version: 2,
  return_type: 'boolean',
  default_value: false,
  rules,
  ...fields,
})

const person = (key: string, operator: string, value: unknown): Case => ({ key, type: 'person', operator, value })

/** `innermost` inside `depth` arrays. */
function nested(depth: number, innermost: unknown = 0): unknown {
  let value: unknown = innermost
  for (let level = 0; level < depth; level++) {
    value = [value]
  }
  return value
}

type EvaluateOptions = {
  identifier?: string
  complete?: boolean
  explicit?: boolean
  // `null` evaluates without a timezone.
  timeZone?: string | null
  active?: boolean
}

function evaluate(
  document: unknown,
  properties: Record<string, unknown> = {},
  { identifier = 'visitor-42', complete = true, explicit = true, timeZone = OSLO, active = true }: EvaluateOptions = {}
): Promise<v2.ConfigV2Outcome> {
  const context: v2.ConfigV2Context = {
    identifier,
    properties,
    propertiesComplete: complete,
    explicitExactMatching: explicit,
    timeZone: timeZone ?? undefined,
    now: NOW,
  }
  return v2.evaluateConfigV2(v2.parseConfigV2(document), context, { active })
}

/**
 * Whether a person whose `plan` is `propertyValue` matches the filter: `true` or `false` for a
 * decided filter. Otherwise the name of what ended the evaluation: the reason of an inconclusive
 * result, or the kind of an error or of a rejected document.
 */
async function match(
  operator: string,
  filterValue: unknown,
  propertyValue: unknown,
  options: EvaluateOptions = {}
): Promise<boolean | string> {
  const outcome = await evaluate(
    filters([targeted([person('plan', operator, filterValue)])]),
    { plan: propertyValue },
    options
  )
  if (outcome.outcome === 'evaluated') {
    return outcome.reason === 'targeting_match'
  }
  return outcome.outcome === 'inconclusive' ? outcome.reason : outcome.kind
}

/** A valid document that uses every part of the format, with one member set. */
function documentWith(path: (string | number)[], value: unknown): Case {
  const document = filters([
    experiment({
      targeting: { properties: [person('plan', 'exact', 'pro')] },
      holdout: { seed: 'layout-holdout', exclusion_percentage: 5 },
    }),
  ])
  let target: any = document
  for (const step of path.slice(0, -1)) {
    target = target[step]
  }
  target[path[path.length - 1]] = value
  return document
}

const RULE = ['rules', 0]
const PROPERTY = [...RULE, 'targeting', 'properties', 0]
const VARIANT = [...RULE, 'variants', 0]
const HOLDOUT = [...RULE, 'holdout']

class Plan {
  name = 'pro'
}

describe('the config version 2 parser', () => {
  it('reads the document the parser cases change', () => {
    expect(v2.isConfigV2Unsupported(v2.parseConfigV2(documentWith(['default_value'], true)))).toBe(false)
  })

  it.each([
    // An unknown field at any level.
    [['unknown'], 1, 'malformed'],
    [[...RULE, 'unknown'], 1, 'malformed'],
    [[...RULE, 'targeting', 'unknown'], 1, 'malformed'],
    [[...PROPERTY, 'unknown'], 1, 'malformed'],
    [[...VARIANT, 'unknown'], 1, 'malformed'],
    [[...HOLDOUT, 'unknown'], 1, 'malformed'],
    // A field of config version 1, or of another rule type.
    [['groups'], [], 'malformed'],
    [[...RULE, 'value'], true, 'malformed'],
    // An unknown literal.
    [['return_type'], 'integer', 'malformed'],
    [[...RULE, 'rule_type'], 'variant_rollout', 'malformed'],
    [[...RULE, 'assignment_algorithm'], 'murmur3', 'malformed'],
    [[...RULE, 'on_rollout_miss'], 'stop', 'malformed'],
    [[...RULE, 'assign_by'], 'group', 'malformed'],
    [[...PROPERTY, 'operator'], 'is_like', 'malformed'],
    [[...PROPERTY, 'operator'], 'in', 'malformed'],
    [[...PROPERTY, 'operator'], 'min', 'malformed'],
    [[...PROPERTY, 'type'], 'event', 'malformed'],
    // A part of the format this evaluator does not read.
    [[...PROPERTY, 'type'], 'cohort', 'unsupported'],
    [[...PROPERTY, 'type'], 'group', 'unsupported'],
    [[...PROPERTY, 'type'], 'flag', 'unsupported'],
    [['aggregation_group_type_index'], 0, 'unsupported'],
    [['aggregation_group_type_index'], 0.5, 'malformed'],
    // A config version that is not the number 2.
    [['version'], 3, 'unsupported'],
    [['version'], 1, 'unsupported'],
    [['version'], '2', 'unsupported'],
    [['version'], true, 'unsupported'],
    [['version'], null, 'unsupported'],
    // A wrong type, or a value out of range.
    [['rules'], {}, 'malformed'],
    [[...RULE, 'id'], RULE_ID.replace(/-/g, ''), 'malformed'],
    [[...RULE, 'paused'], 0, 'malformed'],
    [[...RULE, 'rollout_percentage'], true, 'malformed'],
    [[...RULE, 'rollout_percentage'], 100.5, 'malformed'],
    [[...RULE, 'rollout_percentage'], 12.345, 'malformed'],
    [[...RULE, 'rollout_percentage'], NaN, 'malformed'],
    [[...RULE, 'seed'], '', 'malformed'],
    [[...RULE, 'seed'], 's'.repeat(401), 'malformed'],
    [[...RULE, 'seed'], '\ud800', 'malformed'],
    [[...RULE, 'description'], null, 'malformed'],
    [[...RULE, 'metadata'], [], 'malformed'],
    [[...RULE, 'metadata'], { ratio: Infinity }, 'malformed'],
    [[...RULE, 'metadata'], { when: NOW }, 'malformed'],
    [[...RULE, 'metadata'], { nested: nested(200) }, 'malformed'],
    [[...RULE, 'holdout'], null, 'malformed'],
    [[...RULE, 'variants'], [], 'malformed'],
    [[...VARIANT, 'key'], 'con trol', 'malformed'],
    [[...VARIANT, 'value'], 1, 'malformed'],
    [[...PROPERTY, 'key'], '', 'malformed'],
    [[...PROPERTY, 'negation'], 'yes', 'malformed'],
    [[...PROPERTY, 'group_type_index'], 0, 'malformed'],
    [[...PROPERTY, 'label'], 7, 'malformed'],
    [[...PROPERTY, 'group_key_names'], { 0: 1 }, 'malformed'],
    // Values JSON cannot carry, from a document that did not come from JSON.
    [[...RULE, 'metadata'], { owner: undefined }, 'malformed'],
    [[...RULE, 'metadata'], { plan: new Plan() }, 'malformed'],
    [[...RULE, 'metadata'], { count: BigInt(1) }, 'malformed'],
  ])('rejects the whole document for %j set to %s', async (path, value, kind) => {
    const outcome = await evaluate(documentWith(path as (string | number)[], value), { plan: 'pro' })

    expect(outcome).toMatchObject({ outcome: 'unsupported', kind })
  })

  it.each([
    [['version'], 2.0],
    [[...RULE, 'description'], 'Layout test'],
    [[...RULE, 'metadata'], { owner: { team: ['growth'] }, nested: nested(50) }],
    [[...RULE, 'assign_by'], 'person'],
    [[...RULE, 'rollout_percentage'], 33.33],
    [[...PROPERTY, 'negation'], null],
    [[...PROPERTY, 'group_type_index'], null],
    [[...PROPERTY, 'label'], 'Plan'],
    [[...PROPERTY, 'cohort_name'], null],
    [[...PROPERTY, 'group_key_names'], { 0: 'Acme' }],
  ])('reads %j set to %j', (path, value) => {
    expect(v2.isConfigV2Unsupported(v2.parseConfigV2(documentWith(path as (string | number)[], value)))).toBe(false)
  })

  it.each([[null], [[]], ['{}'], [2], [new Plan()]])('rejects %j, which is not an object, as malformed', (document) => {
    expect(v2.parseConfigV2(document)).toEqual({ outcome: 'unsupported', kind: 'malformed', field: 'filters' })
  })

  it('compares rule IDs whatever their letter case', async () => {
    const upper = targeted([], { id: RULE_ID.toUpperCase() })

    const duplicate = v2.parseConfigV2(filters([targeted(), upper]))
    const outcome = await evaluate(filters([upper]))

    expect(duplicate).toEqual({ outcome: 'unsupported', kind: 'malformed', field: 'rule.id' })
    expect(outcome).toMatchObject({ outcome: 'evaluated', ruleId: RULE_ID })
  })

  it.each([
    ['rules', filters(Array(101).fill(targeted()))],
    ['properties', filters([targeted(Array(101).fill(person('plan', 'is_set', null)))])],
    ['variants', filters([experiment({ variants: Array(21).fill({}) })])],
  ])('rejects a document over the %s limit as malformed', (field, document) => {
    expect(v2.parseConfigV2(document)).toEqual({ outcome: 'unsupported', kind: 'malformed', field })
  })

  it.each([
    ['regex', 5],
    ['icontains', ['a']],
    ['icontains_multi', 'a'],
    ['gt', true],
    ['gt', null],
    ['semver_eq', 3],
    ['semver_eq', 'v1.2.3'],
    ['semver_eq', '1.2.3+build'],
    ['semver_eq', '1.0.0-rc.01'],
    ['semver_eq', '1.x'],
    ['semver_eq', '18446744073709551616.0.0'],
    ['semver_wildcard', '*'],
    ['semver_wildcard', '1.*.3'],
    ['is_date_after', 1704067200],
  ])('rejects a %s filter value of %j as malformed', async (operator, value) => {
    expect(await match(operator, value, 'pro')).toBe('malformed')
  })

  it.each([
    ['2025-06-15T12:00:00'],
    ['2025-06-15 12:00:00 UTC'],
    ['2025-06-15T12:00:00+25:00'],
    ['2025-02-30'],
    ['June 15, 2025'],
    ['1704067200'],
    ['10000d'],
    ['3x'],
  ])('reads the date filter %j as unsupported', async (value) => {
    expect(await match('is_date_after', value, '2025-06-15')).toBe('unsupported')
  })
})

describe('the config version 2 evaluator, beyond the corpora', () => {
  it('reads an absent or null operator as exact', async () => {
    const absent = { key: 'plan', type: 'person', value: 'pro' }

    for (const prop of [absent, { ...absent, operator: null }]) {
      expect(await evaluate(filters([targeted([prop])]), { plan: 'PRO' })).toMatchObject({
        outcome: 'evaluated',
        reason: 'targeting_match',
      })
    }
  })

  it('gives an inactive flag no value, whatever its document holds', async () => {
    const disabled = { outcome: 'evaluated', value: null, reason: 'flag_disabled' }

    expect(await evaluate(filters([targeted()]), {}, { active: false })).toEqual(disabled)
    expect(await evaluate(filters([], { version: 3 }), {}, { active: false })).toEqual(disabled)
  })

  it('stops at a rule it cannot decide, before a later rule', async () => {
    const first = targeted([person('plan', 'exact', 'pro')])
    const document = filters([first, targeted([], { id: OTHER_RULE_ID })])

    expect(await evaluate(document, { country: 'NO' }, { complete: false })).toMatchObject({
      outcome: 'inconclusive',
      reason: 'missing_context',
    })
  })

  it('answers with an earlier terminal rule although a later rule cannot be decided', async () => {
    const later = targeted([person('plan', 'exact', 'pro')], { id: OTHER_RULE_ID })

    expect(await evaluate(filters([targeted(), later]), {}, { complete: false })).toEqual({
      outcome: 'evaluated',
      value: true,
      reason: 'targeting_match',
      ruleId: RULE_ID,
      ruleType: 'targeted_release',
      ruleIndex: 0,
    })
  })

  it.each([
    ['undefined', undefined],
    ['a function', (): string => 'pro'],
    ['a symbol', Symbol('pro')],
  ])('reads a property value that is %s as absent, as JSON does', async (_name, value) => {
    const document = filters([targeted([person('plan', 'is_set', null)])])

    expect(await evaluate(document, { plan: value }, { complete: false })).toMatchObject({
      outcome: 'inconclusive',
      reason: 'missing_context',
    })
    expect(await evaluate(document, { plan: value })).toMatchObject({ reason: 'no_rule_match' })
  })

  it('reads no properties as a missing context', async () => {
    const context = {
      identifier: 'visitor-42',
      properties: null,
      propertiesComplete: true,
      explicitExactMatching: true,
    }
    const document = filters([targeted([person('plan', 'is_set', null)])])

    expect(await v2.evaluateConfigV2(v2.parseConfigV2(document), context)).toMatchObject({
      outcome: 'inconclusive',
      reason: 'missing_context',
    })
  })

  it('cannot hash an identifier that is not Unicode text', async () => {
    const hashed = await evaluate(filters([experiment({ rollout_percentage: 50 })]), {}, { identifier: '\ud800' })
    const notHashed = await evaluate(filters([targeted()]), {}, { identifier: '\ud800' })

    expect(hashed).toMatchObject({ outcome: 'inconclusive', reason: 'missing_context' })
    expect(notHashed).toMatchObject({ outcome: 'evaluated' })
  })

  it('returns an object value as configured', async () => {
    const layout = { columns: 2, panels: [{ id: 'a', ratio: 0.5 }], title: null }
    const document = filters([targeted([], { value: layout })], { return_type: 'object', default_value: null })

    expect(await evaluate(document)).toMatchObject({ outcome: 'evaluated', value: layout })
  })

  it.each([
    // A property value is compared as the JSON text the flags service sees.
    ['exact', 'null', null, true],
    ['exact', ['1.5', '2'], 1.5, true],
    ['exact', '7', 7, true],
    ['exact', '{"a":[1,"b"],"b":true}', { b: true, a: [1, 'b'] }, true],
    ['is_not', 'true', true, false],
    ['icontains', 'ul', null, true],
    ['icontains', '[1,2]', [1, 2], true],
    ['icontains', '0.00001', 0.00001, true],
    ['icontains', '1e-7', 1e-7, true],
    ['icontains_multi', ['x', 'RO'], 'pro', true],
    ['not_icontains_multi', ['x', 'RO'], 'pro', false],
    ['icontains_multi', [], 'pro', false],
    ['icontains_multi', [1.5, true], 'plan-true', true],
    ['regex', '^nu', null, true],
    ['regex', '', 'anything', true],
    // Without a filter value nothing matches, also for is_not.
    ['exact', null, 'pro', false],
    ['is_not', null, 'pro', false],
  ])('%s %j compares the JSON text of %j', async (operator, filterValue, propertyValue, expected) => {
    expect(await match(operator, filterValue, propertyValue)).toBe(expected)
  })

  it.each([
    // Without explicit exact matching, a filter value that looks like a boolean matches by
    // truthiness, whatever its letter case. With it, the filter compares text.
    ['exact', 'TRUE', ['true'], true, false],
    ['exact', 'False', 0, true, false],
    ['exact', [true, 'TRUE'], 'true', true, true],
    ['exact', 'true', 'yes', false, false],
    ['is_not', 'FALSE', false, false, false],
    ['exact', 'pro', 'PRO', true, true],
  ])(
    '%s %j matches %j by truthiness only without explicit exact matching',
    async (operator, filterValue, propertyValue, withoutExplicit, withExplicit) => {
      expect(await match(operator, filterValue, propertyValue, { explicit: false })).toBe(withoutExplicit)
      expect(await match(operator, filterValue, propertyValue)).toBe(withExplicit)
    }
  )

  it.each([
    // JavaScript reads the JSON numbers 7 and 7.0 as one number, and the flags service compares
    // their text, so an integral filter value is left to the server.
    ['exact', 7, '7'],
    ['exact', ['a', 7], 'a'],
    ['icontains_multi', [1, true], 'plan-1'],
  ])('leaves %s %j, an integral filter value, to the server', async (operator, filterValue, propertyValue) => {
    expect(await match(operator, filterValue, propertyValue)).toBe('unsupported_definition')
  })

  const FILTER_VALUES: Record<string, unknown> = {
    icontains_multi: ['pro'],
    not_icontains_multi: ['pro'],
    is_date_exact: '2025-06-15',
    is_date_after: '2025-06-15',
    is_date_before: '2025-06-15',
  }
  const OPERATORS = [
    'exact',
    'is_not',
    'is_set',
    'is_not_set',
    'icontains',
    'not_icontains',
    'starts_with',
    'not_starts_with',
    'ends_with',
    'not_ends_with',
    'icontains_multi',
    'not_icontains_multi',
    'regex',
    'not_regex',
    'gt',
    'gte',
    'lt',
    'lte',
    'semver_eq',
    'semver_neq',
    'semver_gt',
    'semver_gte',
    'semver_lt',
    'semver_lte',
    'semver_tilde',
    'semver_caret',
    'semver_wildcard',
    'is_date_exact',
    'is_date_after',
    'is_date_before',
  ]
  const MATCHING_ABSENCE = [
    'is_not',
    'is_not_set',
    'not_icontains',
    'not_starts_with',
    'not_ends_with',
    'not_icontains_multi',
    'not_regex',
  ]

  it.each(OPERATORS)('matches a person without the property with %s only if it is negative', async (operator) => {
    const document = filters([targeted([person('plan', operator, FILTER_VALUES[operator] ?? '1.2.3')])])

    const outcome = await evaluate(document, {})

    expect(outcome).toMatchObject({
      outcome: 'evaluated',
      reason: MATCHING_ABSENCE.includes(operator) ? 'targeting_match' : 'no_rule_match',
    })
  })

  it('reports an invalid pattern for a person without the property', async () => {
    const document = filters([targeted([person('plan', 'not_regex', '[')])])

    expect(await evaluate(document, {})).toEqual({
      outcome: 'error',
      kind: 'invalid_regex',
      detail: "The pattern for 'plan' is not valid",
    })
  })

  it.each([
    ['(?<=pre)mium', 'premium'],
    ['\\w+', 'café'],
    ['^pro$', 'pro\r'],
  ])('leaves the pattern %j to the server where JavaScript reads it differently', async (pattern, value) => {
    expect(await match('regex', pattern, value)).toBe('unsupported_definition')
  })

  it.each([
    ['gt', '5', '6', true],
    ['gt', 5, '6.0e0', true],
    ['lte', 0.1, '.1', true],
    ['lt', 5, '-inf', true],
    ['gt', 5, 'Infinity', true],
    ['gte', 5, 'nan', false],
    ['lte', 5, 'NaN', false],
    ['gt', 5, true, 'invalid_property'],
    ['gt', 5, 'six', 'invalid_property'],
    ['gt', 5, ' 6', 'invalid_property'],
    ['gt', 5, '6_0', 'invalid_property'],
    ['gt', 5, '0x10', 'invalid_property'],
    ['gt', 5, '', 'invalid_property'],
    ['gt', 5, [6], 'invalid_property'],
    ['gt', 'five', 6, 'invalid_property'],
  ])('%s %j reads %j as the flags service does', async (operator, filterValue, propertyValue, expected) => {
    expect(await match(operator, filterValue, propertyValue)).toBe(expected)
  })

  it.each([
    ['gt', 5, NaN],
    ['gt', 5, Infinity],
    ['gt', 5, NOW],
    ['gt', 5, BigInt(6)],
    ['is_date_after', '2025-06-15', NaN],
    ['is_date_after', '2025-06-15', NOW],
    ['semver_gt', '1.2.3', Infinity],
    ['exact', 'pro', NOW],
    ['exact', '9007199254740993', 2 ** 53 + 2],
    ['icontains', 'pro', NaN],
    ['icontains', 'pro', '\ud800'],
    ['icontains_multi', ['pro'], NOW],
    ['regex', 'pro', NOW],
  ])('%s %j cannot use %s, which JSON cannot carry exactly', async (operator, filterValue, propertyValue) => {
    expect(await match(operator, filterValue, propertyValue)).toBe('missing_context')
  })

  // The flags service reads JSON nested at most 127 arrays or objects deep.
  it.each([
    ['127 arrays around a number', nested(127), false],
    ['127 arrays, the last one empty', nested(126, []), false],
    ['126 arrays around an empty object', nested(126, {}), false],
    ['128 arrays around a number', nested(128), 'missing_context'],
    ['128 arrays, the last one empty', nested(127, []), 'missing_context'],
    ['127 arrays around an empty object', nested(127, {}), 'missing_context'],
  ])('compares the text of %s only up to that depth', async (_name, propertyValue, expected) => {
    for (const [operator, filterValue] of [
      ['exact', 'pro'],
      ['icontains', 'pro'],
      ['regex', 'pro'],
      ['semver_eq', '1.2.3'],
    ]) {
      expect(await match(operator, filterValue, propertyValue)).toBe(expected)
    }
  })

  it.each([
    // Leading zeros, a missing patch number and one leading "v" are read.
    ['semver_eq', '3.8.0', 'v03.08', true],
    ['semver_eq', '3.8.0', 3.8, true],
    ['semver_eq', '3.0.0', 3, true],
    ['semver_eq', '3.8.0', ' 3.8.0\n', true],
    ['semver_eq', '3.8.0', 'V3.8.0', false],
    ['semver_eq', '3.8.0', '3.8.0.1', false],
    ['semver_neq', '3.8.0', 'not a version', false],
    // A pre-release sorts below its release, and its parts sort one by one.
    ['semver_lt', '1.0.0', '1.0.0-rc.1', true],
    ['semver_gt', '1.0.0-alpha', '1.0.0-alpha.1', true],
    ['semver_gt', '1.0.0-alpha.9', '1.0.0-alpha.10', true],
    ['semver_gt', '1.0.0-1', '1.0.0-alpha', true],
    ['semver_eq', '1.0.0-rc.1', '1.0.0-rc.1', true],
    // Build metadata takes part in the comparison.
    ['semver_eq', '1.0.0', '1.0.0+build.5', false],
    ['semver_gt', '1.0.0', '1.0.0+build.5', true],
    ['semver_gt', '1.0.0-rc+7', '1.0.0-rc+10', true],
    // Numbers beyond binary64 compare exactly.
    ['semver_gt', '9007199254740992.0.0', '9007199254740993.0.0', true],
    // A tilde range keeps the minor number.
    ['semver_tilde', '1.2.3', '1.2.9', true],
    ['semver_tilde', '1.2.3', '1.2.2', false],
    ['semver_tilde', '1.2.3', '1.3.0', false],
    ['semver_tilde', '1.2', '1.2.0', true],
    // A caret range keeps the leftmost number that is not zero.
    ['semver_caret', '1.2.3', '1.9.0', true],
    ['semver_caret', '1.2.3', '1.2.2', false],
    ['semver_caret', '1.2.3', '2.0.0', false],
    ['semver_caret', '0.2.3', '0.2.9', true],
    ['semver_caret', '0.2.3', '0.3.0', false],
    ['semver_caret', '0.0.3', '0.0.3', true],
    ['semver_caret', '0.0.3', '0.0.4', false],
    // A range matches a pre-release only of the version it names one for.
    ['semver_caret', '1.2.3', '1.3.0-rc.1', false],
    ['semver_caret', '1.2.3-rc.1', '1.2.3-rc.2', true],
    ['semver_caret', '1.2.3-rc.2', '1.2.3-rc.1', false],
    ['semver_caret', '1.2.3-rc.1', '1.2.4-rc.1', false],
    ['semver_tilde', '1.2.3-rc.1', '1.2.3', true],
    // A wildcard fixes the numbers before the first "*".
    ['semver_wildcard', '1.*', '1.9.9', true],
    ['semver_wildcard', '1.*', '2.0.0', false],
    ['semver_wildcard', '1.*.*', '1.0.0', true],
    ['semver_wildcard', '01.02.*', '1.2.7', true],
    ['semver_wildcard', '1.2.*', '1.3.0', false],
    ['semver_wildcard', '1.2.*', '1.2.3-rc.1', false],
    // Without a "*" the value reads as a caret range.
    ['semver_wildcard', '1.2.3', '1.4.0', true],
    ['semver_wildcard', '1.2', '1.1.0', false],
    ['semver_wildcard', '0.2', '0.3.0', false],
    ['semver_wildcard', '1', '1.0.0', true],
    // The format admits these values, but they are not ranges.
    ['semver_wildcard', '1.2.3.*', '1.2.3', 'invalid_property'],
    ['semver_wildcard', '1.2-rc.*', '1.2.0', 'invalid_property'],
    // After a pre-release the "*" is not a wildcard but the letter "x".
    ['semver_wildcard', '1.2.3-rc.*', '1.2.3-rc.x', true],
    ['semver_wildcard', '1.2.3-rc.*', '1.2.3-rc.w', false],
    ['semver_wildcard', '1.2.3-rc.*', '1.4.0', true],
    ['semver_wildcard', '1.2.3.*', 'not a version', false],
  ])('%s %j orders %j as the flags service does', async (operator, filterValue, propertyValue, expected) => {
    expect(await match(operator, filterValue, propertyValue)).toBe(expected)
  })

  it.each([
    // Nanoseconds are compared.
    ['is_date_after', '2025-06-15T12:00:00Z', '2025-06-15T12:00:00.000000001Z', true],
    ['is_date_exact', '2025-06-15T12:00:00.5Z', '2025-06-15T12:00:00.500Z', true],
    // A date and time without an offset is a wall clock in the project's timezone.
    ['is_date_exact', '2025-06-15 14:00', '2025-06-15T12:00:00Z', true],
    ['is_date_exact', '2025-06-15 14:00:00.25', '2025-06-15T14:00:00.250', true],
    ['is_date_exact', '2025-06-15', '2025-06-14T22:00:00+00:00', true],
    ['is_date_exact', '2025-06-15T12:00:00-03:30', '2025-06-15T15:30:00Z', true],
    ['is_date_exact', '0001-01-01', '0000-12-31T23:00:00Z', 'missing_context'],
    ['is_date_exact', '0099-02-28T23:00:00Z', -59037901200, true],
    // A number is Unix epoch seconds. The fraction of a negative number is dropped.
    ['is_date_exact', '2025-06-15T12:00:00.5Z', 1749988800.5, true],
    ['is_date_exact', '1969-12-31T23:59:58Z', -1.5, true],
    ['is_date_exact', '1970-01-01T00:00:00Z', '0', true],
    ['is_date_before', '2025-06-15', '1e9', true],
    // A property can hold a relative date too.
    ['is_date_exact', '-1d', '1d', true],
    ['is_date_exact', '-2m', '2025-04-15T12:00:00Z', true],
    // A wall clock in a spring-forward gap is no instant.
    ['is_date_exact', '2025-03-30 02:30:00', '2025-03-30T02:30:00', false],
    ['is_date_before', '2026-01-01', '2025-03-30T02:30:00', false],
    // A wall clock that repeats means its first instant.
    ['is_date_exact', '2025-10-26 02:30:00', '2025-10-26T00:30:00Z', true],
    // Not a date at all.
    ['is_date_before', '2026-01-01', 'soon', false],
    ['is_date_before', '2026-01-01', true, false],
    ['is_date_before', '2026-01-01', null, false],
    ['is_date_before', '2026-01-01', ['2025-06-15'], false],
    // A form or a range that only the flags service resolves.
    ['is_date_before', '2026-01-01', '15/06/2025', 'missing_context'],
    ['is_date_before', '2026-01-01', '2025-06-15T12:00:00+0200', 'missing_context'],
    ['is_date_before', '2026-01-01', '2025-06-15t12:00:00z', 'missing_context'],
    ['is_date_before', '2026-01-01', '2025-06-31', 'missing_context'],
    ['is_date_before', '2026-01-01', '2025-06-15T23:59:60Z', 'missing_context'],
    ['is_date_before', '2026-01-01', '99999d', 'missing_context'],
    ['is_date_before', '2026-01-01', 1e12, 'missing_context'],
    ['is_date_before', '2026-01-01', 0.9999999999, 'missing_context'],
    ['is_date_after', '-2025y', '2025-06-15', 'missing_context'],
  ])('%s %j compares %j as the flags service does', async (operator, filterValue, propertyValue, expected) => {
    expect(await match(operator, filterValue, propertyValue)).toBe(expected)
  })

  it.each([
    ['2025-06-15T12:00:00Z', '2025-06-15T14:00:00+02:00', true],
    ['2025-06-15T12:00:00Z', 1749988800, true],
    ['2025-06-15', '2025-06-15T00:00:00Z', 'missing_context'],
    ['2025-06-15T12:00:00Z', '2025-06-15 12:00:00', 'missing_context'],
    ['-1d', '2025-06-14T12:00:00Z', 'missing_context'],
  ])(
    'compares %j with %j without a timezone only when neither needs one',
    async (filterValue, propertyValue, expected) => {
      const result = await match('is_date_exact', filterValue, propertyValue, { timeZone: null })

      expect(result).toBe(expected)
    }
  )

  it('reads a date in UTC without a timezone database', async () => {
    expect(await match('is_date_exact', '2025-06-15 12:00', '2025-06-15T12:00:00Z', { timeZone: 'UTC' })).toBe(true)
    expect(await match('is_date_exact', '-1d', '2025-06-14T12:00:00Z', { timeZone: 'UTC' })).toBe(true)
  })

  it('leaves a date to the server for a timezone it does not know', async () => {
    expect(await match('is_date_exact', '2025-06-15', '2025-06-15', { timeZone: 'Mars/Olympus_Mons' })).toBe(
      'missing_context'
    )
  })

  it('counts a relative date back from the current time by default', async () => {
    const config = v2.parseConfigV2(filters([targeted([person('seen', 'is_date_after', '-1h')])]))
    const now = Math.floor(Date.now() / 1000)
    const evaluateAt = (seen: number): Promise<v2.ConfigV2Outcome> =>
      v2.evaluateConfigV2(config, {
        identifier: 'visitor-42',
        properties: { seen },
        propertiesComplete: true,
        explicitExactMatching: true,
        timeZone: 'UTC',
      })

    expect(await evaluateAt(now)).toMatchObject({ reason: 'targeting_match', ruleId: RULE_ID })
    expect(await evaluateAt(now - 7200)).toEqual({ outcome: 'evaluated', value: false, reason: 'no_rule_match' })
  })

  it('counts every relative date of one evaluation back from the same time', async () => {
    const config = v2.parseConfigV2(filters([targeted([person('seen', 'is_date_exact', '-1d')])]))
    let reads = 0
    class Clock extends Date {
      constructor(...args: unknown[]) {
        // Each read of the clock is one second after the read before it.
        super(args.length === 0 ? NOW.getTime() + 1000 * reads++ : (args[0] as number))
      }
    }
    vi.stubGlobal('Date', Clock)
    try {
      const outcome = await v2.evaluateConfigV2(config, {
        identifier: 'visitor-42',
        properties: { seen: '1d' },
        propertiesComplete: true,
        explicitExactMatching: true,
        timeZone: 'UTC',
      })

      expect(outcome).toMatchObject({ outcome: 'evaluated', reason: 'targeting_match', ruleId: RULE_ID })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each(['UTC', OSLO])(
    'leaves a relative date to the server when the current time is not a date, in %s',
    async (timeZone) => {
      const config = v2.parseConfigV2(filters([targeted([person('seen', 'is_date_after', '-1d')])]))
      const outcome = await v2.evaluateConfigV2(config, {
        identifier: 'visitor-42',
        properties: { seen: '2025-06-15T12:00:00Z' },
        propertiesComplete: true,
        explicitExactMatching: true,
        timeZone,
        now: new Date(NaN),
      })

      expect(outcome).toMatchObject({ outcome: 'inconclusive', reason: 'missing_context' })
    }
  )

  /** The hashes an evaluation draws, when every hash is 0.25. */
  async function hashesDrawn(document: Case, identifier: string): Promise<[string, string, string][]> {
    const drawn: [string, string, string][] = []
    const context = { identifier, properties: {}, propertiesComplete: true, explicitExactMatching: true }
    await v2.evaluateConfigV2WithHash(v2.parseConfigV2(document), context, (use, seed, subject) => {
      drawn.push([use, seed, subject])
      return 0.25
    })
    return drawn
  }

  it('draws the holdout, rollout and variant hashes of an experiment in order', async () => {
    const holdout = { seed: 'layout-holdout', exclusion_percentage: 10 }
    const document = filters([experiment({ rollout_percentage: 50, holdout })])
    // 250 scalar values, each two UTF-16 code units.
    const identifier = '\u{1F600}'.repeat(250)
    const truncated = '\u{1F600}'.repeat(200)

    expect(await hashesDrawn(document, identifier)).toEqual([
      ['holdout', 'layout-holdout', truncated],
      ['rollout', 'layout-test', truncated],
      ['variant', 'layout-test', truncated],
    ])
  })

  it('decides a full percentage and an empty identifier without a hash', async () => {
    const holdout = { seed: 'layout-holdout', exclusion_percentage: 100 }

    expect(await hashesDrawn(filters([experiment({ holdout })]), 'visitor-42')).toEqual([])
    expect(await hashesDrawn(filters([experiment({ rollout_percentage: 50 })]), '')).toEqual([])
    expect(await hashesDrawn(filters([experiment()]), 'visitor-42')).toEqual([['variant', 'layout-test', 'visitor-42']])
  })

  it('writes a decimal as the flags service writes it', () => {
    const cases: [number, string][] = [
      [1.5, '1.5'],
      [-0.25, '-0.25'],
      [0.1, '0.1'],
      [0.00001, '0.00001'],
      [0.000001, '1e-6'],
      [1.25e-7, '1.25e-7'],
      [123456.789, '123456.789'],
      [1000000000000000.5, '1000000000000000.5'],
      [7, '7'],
      [-0, '0'],
    ]
    for (const [value, text] of cases) {
      expect(v2.jsonText(value, 'missing_context')).toBe(text)
    }
  })
})
