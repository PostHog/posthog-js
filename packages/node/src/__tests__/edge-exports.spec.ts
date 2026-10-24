/** @vitest-environment node */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { sentEventsOf } from './utils'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))

describe('built edge entrypoints', () => {
  it.each([
    { specifier: 'posthog-node/edge', loader: 'import', conditions: [] },
    { specifier: 'posthog-node/edge', loader: 'require', conditions: [] },
    { specifier: 'posthog-node', loader: 'import', conditions: ['--conditions=edge'] },
    { specifier: 'posthog-node', loader: 'require', conditions: ['--conditions=edge'] },
  ])('captures through $specifier using $loader ($conditions)', ({ specifier, loader, conditions }) => {
    const output = execFileSync(
      process.execPath,
      [
        ...conditions,
        '--input-type=module',
        '-e',
        `
          import { createRequire } from 'node:module'
          const { PostHog } = ${loader === 'import' ? `await import('${specifier}')` : `createRequire(import.meta.url)('${specifier}')`}
          const requests = []
          const client = new PostHog('test-key', {
            host: 'https://example.test',
            disableCompression: true,
            fetchRetryCount: 0,
            fetch: async (url, options) => {
              requests.push([url, { headers: options.headers, body: options.body }])
              return { status: 200, text: async () => '{}', json: async () => ({}) }
            },
          })
          client.capture({ distinctId: 'edge-user', event: 'edge-event' })
          await client.shutdown()
          console.log(JSON.stringify(requests))
        `,
      ],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        timeout: 10_000,
      }
    )

    expect(JSON.parse(output).flatMap(sentEventsOf)).toEqual([
      expect.objectContaining({
        distinct_id: 'edge-user',
        event: 'edge-event',
        properties: expect.objectContaining({ $lib: 'posthog-edge' }),
      }),
    ])
  })
})
