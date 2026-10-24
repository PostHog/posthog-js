/** @vitest-environment node */

import { type AddressInfo } from 'node:net'
import { createServer, type Server } from 'node:http'
import { gunzipSync } from 'node:zlib'

import { V1CaptureSender } from '@/capture-v1/sender'
import { serializeV1Event } from '@/capture-v1/serialize'
import { zlibCompressor } from '@/compression.node'

// Node's fetch throws when it replays a byte body on a redirect it follows itself, so this runs against a real server.
describe('capture redirects through Node fetch', () => {
  let server: Server
  let host: string
  const received: { url: string; encoding?: string; body: Buffer }[] = []

  beforeAll(async () => {
    vi.useRealTimers()
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        received.push({
          url: request.url!,
          encoding: request.headers['content-encoding'] as string | undefined,
          body: Buffer.concat(chunks),
        })
        if (request.url === '/i/v1/analytics/events') {
          response.writeHead(307, { Location: '/moved/i/v1/analytics/events' }).end()
        } else {
          response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"results":{}}')
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    vi.useFakeTimers()
  })

  it('resends a compressed body to a same-origin 307 target', async () => {
    const errors: Error[] = []
    const sender = new V1CaptureSender(
      {
        host,
        path: '/i/v1/analytics/events',
        apiKey: 'phc_test',
        libraryId: 'posthog-node',
        libraryVersion: '1.2.3',
        historicalMigration: false,
        compression: 'gzip',
        requestTimeoutMs: 5000,
        maxRetries: 0,
      },
      {
        fetch: (url, options) => fetch(url, options as RequestInit),
        onError: (error) => errors.push(error),
        compress: (payload, codec) => zlibCompressor.compress(payload, codec),
      }
    )

    await sender.send([serializeV1Event({ event: 'e', distinct_id: 'u', uuid: 'u1', properties: {} })])

    expect(errors).toEqual([])
    expect(received.map(({ url, encoding }) => [url, encoding])).toEqual([
      ['/i/v1/analytics/events', 'gzip'],
      ['/moved/i/v1/analytics/events', 'gzip'],
    ])
    for (const { body } of received) {
      expect(JSON.parse(gunzipSync(body).toString()).batch[0].uuid).toBe('u1')
    }
  })
})
