/**
 * Legacy flag getter and event scenarios, written against the public client API only, so the same
 * scenarios run on a released posthog-node and on this source.
 *
 * `fixtures/released-flags-5.61.2.json` holds what posthog-node 5.61.2 returned and sent for each
 * scenario, from the `v2` response shape it requests. `released-flags.spec.ts` runs the scenarios
 * on this source from the `v2` and the `v4` shape and compares them with that recording.
 *
 * The module has no imports and uses only erasable TypeScript, so Node can run it directly. To
 * record it again (Node 22.18 or later), from an empty directory:
 *
 *   npm install posthog-node@5.61.2
 *   node --input-type=module -e "
 *     import { writeFileSync } from 'node:fs'
 *     import { PostHog } from 'posthog-node'
 *     import { recordReleasedResults } from '<repo>/packages/node/src/__tests__/released-flags-scenarios.ts'
 *     writeFileSync('<repo>/packages/node/src/__tests__/fixtures/released-flags-5.61.2.json',
 *       JSON.stringify(await recordReleasedResults(PostHog, '5.61.2'), null, 2) + '\n')"
 */

export type Shape = 'v2' | 'v4'

type Reason = { code: string; condition_index: number | null; description: string }

type FlagSpec = {
  key: string
  // The record a server sends at v2.
  enabled: boolean
  variant: string | null
  payload: string | null
  // The record a server sends at v4.
  value: unknown
  configVersion: 1 | 2
  rule?: { rule_type: string; rule_id: string; variant_key?: string }
  // Shared metadata. An absent id or version is left out of both records.
  id?: number
  version?: number
  hasExperiment?: boolean
  failed?: boolean
  reason: Reason | null
}

const MATCHED: Reason = { code: 'condition_match', condition_index: 0, description: 'Matched condition set 1' }
const NOT_MATCHED: Reason = {
  code: 'no_condition_match',
  condition_index: null,
  description: 'No matching condition set',
}
const RULE_ID = '50000000-0000-4000-8000-000000000001'

export const PARITY_FLAGS: FlagSpec[] = [
  {
    key: 'bool-on',
    enabled: true,
    variant: null,
    payload: '{"plan":"pro"}',
    value: true,
    configVersion: 1,
    reason: MATCHED,
  },
  {
    key: 'bool-off',
    enabled: false,
    variant: null,
    payload: null,
    value: false,
    configVersion: 1,
    reason: NOT_MATCHED,
  },
  {
    key: 'v1-variant',
    enabled: true,
    variant: 'control',
    payload: '{"columns": 2}',
    value: 'control',
    configVersion: 1,
    rule: { rule_type: 'experiment', rule_id: RULE_ID, variant_key: 'control' },
    hasExperiment: true,
    reason: MATCHED,
  },
  {
    key: 'v2-string',
    enabled: true,
    variant: 'compact',
    payload: null,
    value: 'compact',
    configVersion: 2,
    rule: { rule_type: 'targeted_release', rule_id: RULE_ID },
    reason: MATCHED,
  },
  {
    key: 'v2-split',
    enabled: true,
    variant: 'arm-b',
    payload: null,
    value: 'arm-b',
    configVersion: 2,
    rule: { rule_type: 'experiment', rule_id: RULE_ID, variant_key: 'arm-b' },
    hasExperiment: true,
    reason: MATCHED,
  },
  { key: 'v2-false', enabled: false, variant: null, payload: null, value: false, configVersion: 2, reason: MATCHED },
  { key: 'v2-null', enabled: false, variant: null, payload: null, value: null, configVersion: 2, reason: NOT_MATCHED },
  { key: 'v2-number', enabled: true, variant: null, payload: '12.5', value: 12.5, configVersion: 2, reason: MATCHED },
  { key: 'v2-zero', enabled: true, variant: null, payload: '0', value: 0, configVersion: 2, reason: MATCHED },
  {
    key: 'v2-tiny-float',
    enabled: true,
    variant: null,
    payload: '1e-7',
    value: 1e-7,
    configVersion: 2,
    reason: MATCHED,
  },
  {
    key: 'v2-object',
    enabled: true,
    variant: null,
    payload: '{"layout":"compact","columns":[1,2],"beta":null}',
    value: { layout: 'compact', columns: [1, 2], beta: null },
    configVersion: 2,
    reason: MATCHED,
  },
  { key: 'v2-empty-object', enabled: true, variant: null, payload: '{}', value: {}, configVersion: 2, reason: MATCHED },
  {
    key: 'sparse',
    enabled: true,
    variant: 'compact',
    payload: null,
    value: 'compact',
    configVersion: 1,
    id: undefined,
    version: undefined,
    reason: null,
  },
]

export const FAILED_FLAG: FlagSpec = {
  key: 'failed',
  enabled: false,
  variant: null,
  payload: null,
  value: null,
  configVersion: 2,
  failed: true,
  reason: { code: 'dependency_error', condition_index: null, description: 'A dependency could not be evaluated' },
}

const HEALTHY_FLAG: FlagSpec = {
  key: 'healthy',
  enabled: true,
  variant: 'compact',
  payload: '{"columns":2}',
  value: 'compact',
  configVersion: 1,
  id: 601,
  reason: MATCHED,
}

let nextId = 500

function record(spec: FlagSpec, shape: Shape): Record<string, unknown> {
  const metadata: Record<string, unknown> = { description: null, payload: spec.payload }
  const id = Object.prototype.hasOwnProperty.call(spec, 'id') ? spec.id : nextId++
  if (id !== undefined) {
    metadata.id = id
  }
  const version = Object.prototype.hasOwnProperty.call(spec, 'version') ? spec.version : 4
  if (version !== undefined) {
    metadata.version = version
  }
  metadata.has_experiment = spec.hasExperiment ?? false
  const flag: Record<string, unknown> = { key: spec.key, reason: spec.reason }
  if (shape === 'v2') {
    flag.enabled = spec.enabled
    flag.variant = spec.variant
  } else {
    flag.value = spec.failed ? null : spec.value
    metadata.config_version = spec.configVersion
    // v4 sends no payload for config version 2 flags; a number or object value is its own payload.
    if (spec.configVersion === 2) {
      metadata.payload = null
    }
    Object.assign(metadata, spec.rule ?? {})
  }
  if (spec.failed) {
    flag.failed = true
  }
  flag.metadata = metadata
  return flag
}

function response(flags: Record<string, unknown>, errorsWhileComputingFlags = false): unknown {
  return {
    flags,
    errorsWhileComputingFlags,
    requestId: '50000000-0000-4000-8000-000000000000',
    evaluatedAt: 1800000000000,
  }
}

function responseFor(shape: Shape, specs: FlagSpec[], errorsWhileComputingFlags = false): unknown {
  nextId = 500
  return response(Object.fromEntries(specs.map((spec) => [spec.key, record(spec, shape)])), errorsWhileComputingFlags)
}

/** A record with a known field of the wrong JSON type, next to a healthy sibling. */
function unreadableResponse(shape: Shape): unknown {
  nextId = 500
  const unreadable = record({ ...HEALTHY_FLAG, key: 'unreadable', id: 602 }, shape)
  if (shape === 'v2') {
    unreadable.reason = 'oops'
  } else {
    ;(unreadable.metadata as Record<string, unknown>).id = '201'
  }
  return response({ unreadable, healthy: record(HEALTHY_FLAG, shape) })
}

/** The same response with the unreadable record replaced by a disabled flag without reason or metadata. */
function unreadableAsDisabledResponse(shape: Shape): unknown {
  nextId = 500
  const disabled = shape === 'v2' ? { key: 'unreadable', enabled: false } : { key: 'unreadable', value: false }
  return response({ unreadable: disabled, healthy: record(HEALTHY_FLAG, shape) })
}

const UNDEFINED = '<undefined>'

// JSON semantics for everything below the top level, with an explicit marker for an undefined
// result, so the recording tells an undefined result apart from a missing scenario.
function plain(value: unknown): unknown {
  return value === undefined ? UNDEFINED : JSON.parse(JSON.stringify(value))
}

function flagProperties(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([key]) => key.startsWith('$feature') || key === '$active_feature_flags' || key === 'locally_evaluated'
    )
  )
}

async function getters(PostHog: any, body: unknown, keys: string[]): Promise<Record<string, unknown>> {
  const fetch = async (url: string): Promise<unknown> => {
    const json = url.includes('/flags/') ? structuredClone(body) : { status: 'ok' }
    return { status: 200, text: async () => JSON.stringify(json), json: async () => json }
  }
  const client = new PostHog('phc_released_flags_test', {
    host: 'http://localhost:8010',
    fetch,
    fetchRetryCount: 0,
    flushAt: 1000,
    flushInterval: 0,
    disableCompression: true,
  })
  const events: unknown[] = []
  client.on('capture', (message: any) => {
    if (message && typeof message === 'object') {
      events.push([message.event, message.distinct_id, plain(flagProperties(message.properties ?? {}))])
    }
  })

  const outputs: Record<string, unknown> = {}
  const allKeys = [...keys, 'missing']
  for (const key of allKeys) {
    outputs[`getFeatureFlag:${key}`] = plain(await client.getFeatureFlag(key, 'getter-user'))
    outputs[`isFeatureEnabled:${key}`] = plain(await client.isFeatureEnabled(key, 'enabled-user'))
    outputs[`getFeatureFlagPayload:${key}`] = plain(await client.getFeatureFlagPayload(key, 'payload-user'))
    outputs[`getFeatureFlagResult:${key}`] = plain(await client.getFeatureFlagResult(key, 'result-user'))
  }
  outputs.getAllFlags = plain(await client.getAllFlags('all-user'))
  outputs.getAllFlagsAndPayloads = plain(await client.getAllFlagsAndPayloads('all-user'))

  const snapshot = await client.evaluateFlags('snapshot-user')
  outputs['snapshot.keys'] = [...snapshot.keys].sort()
  for (const key of allKeys) {
    outputs[`snapshot.isEnabled:${key}`] = plain(snapshot.isEnabled(key))
    outputs[`snapshot.getFlag:${key}`] = plain(snapshot.getFlag(key))
    outputs[`snapshot.getFlagPayload:${key}`] = plain(snapshot.getFlagPayload(key))
  }
  client.capture({ distinctId: 'snapshot-user', event: 'snapshot-event', flags: snapshot })
  client.capture({ distinctId: 'capture-user', event: 'fetched-event', sendFeatureFlags: true })
  await client.shutdown()

  // Events are captured asynchronously, so their order is not part of the contract.
  outputs.events = events
    .map((event) => JSON.stringify(event))
    .sort()
    .map((event) => JSON.parse(event))
  return outputs
}

/** Every scenario, from the given response shape. */
export async function runAll(PostHog: any, shape: Shape): Promise<Record<string, Record<string, unknown>>> {
  const parityKeys = PARITY_FLAGS.map((spec) => spec.key)
  return {
    getters: await getters(PostHog, responseFor(shape, PARITY_FLAGS), parityKeys),
    'getters with a failed flag': await getters(PostHog, responseFor(shape, [FAILED_FLAG, HEALTHY_FLAG], true), [
      'failed',
      'healthy',
    ]),
    'getters with an unreadable record': await getters(PostHog, unreadableResponse(shape), ['unreadable', 'healthy']),
    'getters with the unreadable record read as disabled': await getters(PostHog, unreadableAsDisabledResponse(shape), [
      'unreadable',
      'healthy',
    ]),
  }
}

/** The recording of a released SDK, which reads the `v2` shape it requests. */
export async function recordReleasedResults(PostHog: any, version: string): Promise<unknown> {
  return { version, shape: 'v2', results: await runAll(PostHog, 'v2') }
}
