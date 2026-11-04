import { createHash } from 'node:crypto'

export const cases = [
  'boolean',
  'rollout',
  'variant',
  'property',
  'regex',
  'cohort',
  'early',
  'late',
  'no-match',
  'inactive',
]
export const users = Array.from({ length: 16 }, (_, i) => ({
  distinctId: `benchmark-user-${i}`,
  personProperties: { plan: i % 2 ? 'free' : 'pro', email: `user-${i}@example.test`, score: i },
}))

const property = (key, value, operator = 'exact') => ({ key, value, operator, type: 'person' })
const group = (properties = [], rollout_percentage = 100) => ({ properties, rollout_percentage })

export function definitions(count, generation = 0) {
  return {
    group_type_mapping: {},
    cohorts: {
      '1': {
        type: 'AND',
        values: [property('plan', ['pro']), property('score', generation % 2 ? 100 : -1, 'gt')],
      },
    },
    flags: Array.from({ length: count }, (_, i) => {
      const kind = cases[i % cases.length]
      const match = group([property('plan', ['pro'])])
      const miss = group([property('plan', ['never'])])
      let groups = [group()]
      if (kind === 'rollout') groups = [group([], 50)]
      if (kind === 'property') groups = [match]
      if (kind === 'regex')
        groups = [group([property('email', `^(user|refresh-${generation})-[0-9]+@example[.]test$`, 'regex')])]
      if (kind === 'cohort') groups = [group([{ key: 'id', value: 1, type: 'cohort' }])]
      if (kind === 'early') groups = [match, ...Array.from({ length: 7 }, () => miss)]
      if (kind === 'late') groups = [...Array.from({ length: 7 }, () => miss), match]
      if (kind === 'no-match') groups = Array.from({ length: 8 }, () => miss)
      return {
        id: i + 1,
        key: `${kind}-${i}`,
        name: `${kind}-${i}`,
        active: kind !== 'inactive' && (kind !== 'boolean' || generation % 2 === 0),
        filters: {
          groups,
          ...(kind === 'variant'
            ? {
                multivariate: {
                  variants: [
                    { key: 'control', rollout_percentage: 50 },
                    { key: 'test', rollout_percentage: 50 },
                  ],
                },
              }
            : {}),
        },
      }
    }),
  }
}

// Independent expected values for these fixed fixtures; never call the SDK evaluator as the oracle.
function bucket(key, distinctId, salt = '') {
  return (
    Number.parseInt(createHash('sha1').update(`${key}.${distinctId}${salt}`).digest('hex').slice(0, 15), 16) / 2 ** 60
  )
}

export function expectedValue(index, user, generation = 0) {
  const kind = cases[index % cases.length]
  const key = `${kind}-${index}`
  if (kind === 'rollout') return bucket(key, user.distinctId) < 0.5
  if (kind === 'variant') return bucket(key, user.distinctId, 'variant') < 0.5 ? 'control' : 'test'
  if (kind === 'boolean') return generation % 2 === 0
  if (kind === 'cohort' && generation % 2) return false
  if (['property', 'cohort', 'early', 'late'].includes(kind)) return user.personProperties.plan === 'pro'
  return kind !== 'no-match' && kind !== 'inactive'
}

export function expectedFlags(count, user, generation = 0) {
  return Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`${cases[i % cases.length]}-${i}`, expectedValue(i, user, generation)])
  )
}

export function digest(value) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex')
}

export function workloads(smoke = false) {
  const singleOperations = smoke ? 160 : 16000
  return [
    ...cases.slice(0, 9).map((kind, index) => ({
      id: `flags.single.${kind}`,
      mode: 'single',
      flag_count: 10,
      flag_index: index,
      operations: singleOperations,
      concurrency: 1,
      passes: ['timing', 'allocation'],
    })),
    ...[10, 100, 1000].map((flag_count) => ({
      id: `flags.all.${flag_count}`,
      mode: 'all',
      flag_count,
      operations: smoke ? 16 : Math.max(160, 16000 / flag_count),
      concurrency: 1,
      passes: ['timing', 'allocation'],
    })),
    {
      id: 'flags.load.1000',
      mode: 'all',
      flag_count: 1000,
      operations: smoke ? 32 : 1600,
      concurrency: 8,
      passes: ['memory'],
    },
    {
      id: 'flags.refresh.1000',
      mode: 'refresh',
      flag_count: 1000,
      operations: smoke ? 4 : 40,
      concurrency: 1,
      passes: ['memory'],
    },
    ...[32, 4096].map((payload_bytes) => ({
      id: `capture.enqueue.${payload_bytes}`,
      mode: 'capture',
      payload_bytes,
      operations: smoke ? 100 : 2000,
      concurrency: 1,
      passes: ['timing', 'allocation'],
    })),
    {
      id: 'capture.drain.4096',
      mode: 'drain',
      payload_bytes: 4096,
      operations: smoke ? 200 : 10000,
      concurrency: 1,
      passes: ['memory'],
    },
  ]
}
