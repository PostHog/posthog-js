/** @vitest-environment node */

import { spawn } from 'node:child_process'
import { type IncomingMessage, type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../../', import.meta.url))

interface ChildResult {
  code: number | null
  stderr: string
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function runChild(host: string): Promise<ChildResult> {
  // Uses the built package, like a real script would. Nothing but the SDK's own timers can keep this process alive.
  const script = `
    import { PostHog } from 'posthog-node'
    const posthog = new PostHog('phc_process_exit_test', {
      host: '${host}',
      disableCompression: true,
      fetchRetryCount: 3,
      fetchRetryDelay: 50,
    })
    posthog.capture({ distinctId: 'exit-user', event: 'exit-event' })
    await posthog.shutdown()
  `
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: packageRoot })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stderr }))
  })
}

describe('capture v1 in a short-lived process', () => {
  let server: Server
  let host: string
  let attempts: number
  const delivered: unknown[] = []

  beforeEach(async () => {
    vi.useRealTimers()
    attempts = 0
    delivered.length = 0
    server = createServer(async (req, res) => {
      const body = await readBody(req)
      attempts++
      if (attempts === 1) {
        res.writeHead(500).end()
        return
      }
      delivered.push(...JSON.parse(body).batch)
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"results":{}}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  it('keeps the process alive through a retry wait until an awaited shutdown delivers the event', async () => {
    const result = await runChild(host)

    expect(result.stderr).not.toContain('unsettled top-level await')
    expect(result.code).toBe(0)
    expect(attempts).toBe(2)
    expect(delivered).toEqual([expect.objectContaining({ event: 'exit-event', distinct_id: 'exit-user' })])
  }, 15_000)
})
