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
export function transport(payloadBytes = 0, capacity = 1000) {
  let serializedDefinitions = ''
  const expectedPayload = 'x'.repeat(payloadBytes)
  const deliveredByUser = Object.fromEntries(users.map((user) => [user.distinctId, 0]))
  const seen = new Uint8Array(capacity)
  const state = { definitions: 0, delivered: 0, deliveredByUser, requests: 0, invalidEvents: 0, unexpected: [] }
  return {
    state,
    reset() {
      state.definitions = 0
      state.delivered = 0
      state.requests = 0
      state.invalidEvents = 0
      state.unexpected.length = 0
      seen.fill(0)
      for (const user of users) deliveredByUser[user.distinctId] = 0
    },
    verifyDelivery(expected) {
      assert.equal(state.delivered, expected, 'Delivered counts must match captures')
      assert.equal(state.invalidEvents, 0, 'Payload, identity and unique sequence must match')
      for (let i = 0; i < seen.length; i++) {
        assert.equal(seen[i], i < expected ? 1 : 0, `Unexpected delivery count for sequence ${i}`)
      }
    },
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
          const sequence = event.properties?.sequence
          if (
            event.event !== 'benchmark' ||
            !Number.isInteger(sequence) ||
            sequence < 0 ||
            sequence >= seen.length ||
            seen[sequence] !== 0 ||
            event.distinct_id !== users[sequence % users.length]?.distinctId ||
            event.properties?.payload !== expectedPayload ||
            event.properties?.plan !== 'pro'
          ) {
            state.invalidEvents++
          } else {
            seen[sequence] = 1
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
  const network = transport(spec.payload_bytes, spec.operations)
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
  // Each call owns its properties; later captures never mutate submitted input.
  const payload = 'x'.repeat(spec.payload_bytes ?? 0)
  const events = isFlags
    ? []
    : Array.from({ length: spec.operations }, (_, sequence) => ({
        event: 'benchmark',
        distinctId: users[sequence % users.length].distinctId,
        properties: { payload, plan: 'pro', sequence },
      }))
  let captured = 0
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
    async reset() {
      // Only reset a phase after its public lifecycle and correctness checks complete.
      await this.verify()
      if (isFlags) {
        generation = 0
        network.setDefinitions(definitions(spec.flag_count, generation))
        const previous = network.state.definitions
        await client.reloadFeatureFlags()
        assert.equal(network.state.definitions, previous + 1)
        await checkFlags()
        checkTransport()
      }
      captured = 0
      checks.evaluations = 0
      network.reset()
    },
    async run(operations = spec.operations, checkpoint) {
      if (spec.mode === 'refresh') {
        for (let i = 0; i < operations; i++) {
          generation++
          network.setDefinitions(definitions(spec.flag_count, generation))
          const previous = network.state.definitions
          await client.reloadFeatureFlags()
          assert.equal(network.state.definitions, previous + 1, 'Reload must fetch new definitions')
          if (checkpoint) await checkpoint(i + 1)
        }
      } else if (spec.mode === 'capture' || spec.mode === 'drain') {
        assert.ok(captured + operations <= events.length, 'Reset before starting another capture phase')
        for (let offset = 0; offset < operations; offset += 100) {
          const end = Math.min(operations, offset + 100)
          for (let i = offset; i < end; i++) {
            client.capture(events[captured])
            captured++
          }
          // capture() returns void; include its asynchronous preparation/enqueue microtasks.
          await setImmediate()
          if (spec.mode === 'drain' && spec.drain_strategy === 'steady') await client.flush()
          if (checkpoint) await checkpoint(end)
        }
        if (spec.mode === 'drain' && spec.drain_strategy === 'burst') await client.flush()
      } else {
        for (let offset = 0; offset < operations; offset += spec.concurrency) {
          if (spec.concurrency === 1) {
            await evaluate(offset)
          } else {
            await Promise.all(
              Array.from({ length: Math.min(spec.concurrency, operations - offset) }, (_, i) => evaluate(offset + i))
            )
          }
          const completed = Math.min(offset + spec.concurrency, operations)
          if (checkpoint && (completed % 32 === 0 || completed === operations)) await checkpoint(completed)
        }
      }
    },
    async verify() {
      if (isFlags) await checkFlags()
      else {
        // Enqueue delivery is outside measurement; completed-delivery verification cannot rescue a missed flush.
        if (spec.mode === 'capture') await client.flush()
        network.verifyDelivery(captured)
      }
      checkTransport()
      return {
        ...network.state,
        deliveredByUser: { ...network.state.deliveredByUser },
        ...checks,
        captured,
        generation,
      }
    },
    async close() {
      await client.shutdown()
    },
  }
}
