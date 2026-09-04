import assert from 'node:assert/strict'

import { waitForPackages } from './wait-for-packages.mjs'

const packages = new Map([['posthog-node', '5.0.0']])

{
  const lookups = []
  const delays = []
  const logs = []
  await waitForPackages(packages, {
    attempts: 5,
    execute(command, args, options) {
      lookups.push({ command, args, options })
      if (lookups.length < 3) {
        throw new Error('not published yet')
      }
      return '5.0.0\n'
    },
    log(message) {
      logs.push(message)
    },
    retryDelayMs: 1,
    async sleep(milliseconds) {
      delays.push(milliseconds)
    },
  })

  assert.equal(lookups.length, 3)
  assert.deepEqual(lookups[0].args, ['view', 'posthog-node@5.0.0', 'version'])
  assert.equal(lookups[0].options.timeout, 30_000)
  assert.deepEqual(delays, [1, 1])
  assert.match(logs.at(-1), /posthog-node@5\.0\.0 is available on npm/)
}

{
  let lookupCount = 0
  const delays = []
  await assert.rejects(
    waitForPackages(packages, {
      attempts: 3,
      execute() {
        lookupCount++
        throw new Error('not published yet')
      },
      log() {},
      retryDelayMs: 1,
      async sleep(milliseconds) {
        delays.push(milliseconds)
      },
    }),
    /posthog-node@5\.0\.0 did not become available on npm after 3 attempts/
  )
  assert.equal(lookupCount, 3)
  assert.deepEqual(delays, [1, 1])
}
