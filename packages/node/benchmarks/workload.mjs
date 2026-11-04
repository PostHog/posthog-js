import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { cases, definitions, expectedFlags, expectedValue, users } from './fixtures.mjs'

// Use the target installation's package entry, not module resolution from the benchmark checkout.
export function loadSdk(sdkDirectory) {
  const require = createRequire(resolve(sdkDirectory, 'package.json'))
  const entry = require.resolve(resolve(sdkDirectory))
  const { PostHog } = require(entry)
  assert.equal(typeof PostHog, 'function')
  return { PostHog, entry }
}

// The public fetch seam keeps benchmarks offline. It exercises loading, parsing and delivery
// without including an HTTP server or retaining captured events in the measured process.
export function transport(payloadBytes = 0) {
  let serializedDefinitions = ''
  const expectedPayload = 'x'.repeat(payloadBytes)
  const deliveredByUser = Object.fromEntries(users.map((user) => [user.distinctId, 0]))
  const state = { definitions: 0, delivered: 0, deliveredByUser, requests: 0, invalidEvents: 0, unexpected: [] }
  return {
    state,
    setDefinitions(value) {
      serializedDefinitions = JSON.stringify(value)
    },
    async fetch(url, options = {}) {
      const path = new URL(url).pathname
      if (path === '/flags/definitions' && (!options.method || options.method === 'GET')) {
        state.definitions++
        return { status: 200, headers: new Headers(), json: async () => JSON.parse(serializedDefinitions) }
      }
      if (path === '/batch/' && options.method === 'POST') {
        const { batch } = JSON.parse(options.body)
        assert.ok(Array.isArray(batch))
        state.requests++
        state.delivered += batch.length
        for (const event of batch) {
          if (
            event.event !== 'benchmark' ||
            !Object.hasOwn(deliveredByUser, event.distinct_id) ||
            event.properties?.payload !== expectedPayload ||
            event.properties?.plan !== 'pro'
          ) {
            state.invalidEvents++
          } else {
            deliveredByUser[event.distinct_id]++
          }
        }
        return { status: 200, text: async () => 'ok', json: async () => ({ status: 1 }) }
      }
      state.unexpected.push(path)
      throw new Error(`Unexpected benchmark request: ${path}`)
    },
  }
}

export async function createWorkload(spec, sdkDirectory) {
  const { PostHog, entry } = loadSdk(sdkDirectory)
  const network = transport(spec.payload_bytes)
  const errors = []
  const isFlags = ['single', 'all', 'refresh'].includes(spec.mode)
  if (isFlags) network.setDefinitions(definitions(spec.flag_count))
  const client = new PostHog('benchmark-project-key', {
    host: 'http://benchmark.invalid',
    fetch: network.fetch,
    flushInterval: 0,
    flushAt: 100000,
    maxQueueSize: 100001,
    maxBatchSize: 100000,
    disableCompression: true,
    fetchRetryCount: 0,
    ...(isFlags ? { personalApiKey: 'benchmark-local-only', featureFlagsPollingInterval: null } : {}),
  })
  client.on('error', (error) => errors.push(String(error)))
  const flagOptions = users.map((user) => ({
    onlyEvaluateLocally: true,
    sendFeatureFlagEvents: false,
    personProperties: user.personProperties,
  }))
  const events = users.map((user) => ({
    event: 'benchmark',
    distinctId: user.distinctId,
    properties: { payload: 'x'.repeat(spec.payload_bytes ?? 0), plan: 'pro' },
  }))
  let captured = 0
  const capturedByUser = Object.fromEntries(users.map((user) => [user.distinctId, 0]))
  let generation = 0
  const checks = { evaluations: 0 }

  async function evaluate(index) {
    const userIndex = index % users.length
    if (spec.mode === 'single') {
      return client.getFeatureFlag(
        `${cases[spec.flag_index]}-${spec.flag_index}`,
        users[userIndex].distinctId,
        flagOptions[userIndex]
      )
    }
    return client.getAllFlags(users[userIndex].distinctId, flagOptions[userIndex])
  }

  async function checkFlags() {
    for (let i = 0; i < users.length; i++) {
      const result = await evaluate(i)
      assert.deepEqual(
        result,
        spec.mode === 'single'
          ? expectedValue(spec.flag_index, users[i], generation)
          : expectedFlags(spec.flag_count, users[i], generation)
      )
      checks.evaluations++
    }
  }

  async function drain() {
    await client.flush()
    assert.equal(network.state.delivered, captured, 'Delivered counts must match captures')
    assert.equal(network.state.invalidEvents, 0)
    assert.deepEqual(network.state.deliveredByUser, capturedByUser)
  }

  function checkTransport() {
    assert.deepEqual(network.state.unexpected, [], 'Local-only evaluation must not fall back remotely')
    assert.deepEqual(errors, [])
  }

  try {
    if (isFlags) {
      // This also awaits the initial definition load started by the constructor.
      await checkFlags()
      assert.ok(network.state.definitions > 0)
    }
    checkTransport()
  } catch (error) {
    await client.shutdown()
    throw error
  }

  return {
    entry,
    async run(operations = spec.operations, checkpoint) {
      if (spec.mode === 'refresh') {
        for (let i = 0; i < operations; i++) {
          generation++
          network.setDefinitions(definitions(spec.flag_count, generation))
          const previous = network.state.definitions
          await client.reloadFeatureFlags()
          assert.equal(network.state.definitions, previous + 1, 'Reload must fetch new definitions')
          await checkFlags()
          if (checkpoint) await checkpoint(i + 1)
        }
      } else if (spec.mode === 'capture' || spec.mode === 'drain') {
        for (let offset = 0; offset < operations; offset += 100) {
          const end = Math.min(operations, offset + 100)
          for (let i = offset; i < end; i++) {
            client.capture(events[i % events.length])
            captured++
            capturedByUser[users[i % users.length].distinctId]++
          }
          // capture() returns void; include its asynchronous preparation/enqueue microtasks.
          await setImmediate()
          if (spec.mode === 'drain') await drain()
          if (checkpoint) await checkpoint(end)
        }
      } else {
        for (let offset = 0; offset < operations; offset += spec.concurrency) {
          if (spec.concurrency === 1) {
            await evaluate(offset)
          } else {
            await Promise.all(
              Array.from({ length: Math.min(spec.concurrency, operations - offset) }, (_, i) => evaluate(offset + i))
            )
          }
          if (checkpoint && offset % 32 === 0) await checkpoint(Math.min(offset + spec.concurrency, operations))
        }
      }
    },
    async verify() {
      if (isFlags) await checkFlags()
      else await drain()
      checkTransport()
      return { ...network.state, ...checks, captured }
    },
    async close() {
      await client.shutdown()
    },
  }
}
