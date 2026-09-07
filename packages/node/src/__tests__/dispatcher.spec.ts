import http from 'node:http'
import net from 'node:net'
import { Agent, setGlobalDispatcher } from 'undici'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONNECT_TIMEOUT, fetchWithConnectTimeout, resolveDispatcher } from '../dispatcher.node'

const UNDICI_GLOBAL_DISPATCHER = Symbol.for('undici.globalDispatcher.1')

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"status":1}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as net.AddressInfo
  try {
    await run(`http://localhost:${port}/`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function connectOptions(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const call = spy.mock.calls.find(([options]) => typeof options === 'object' && options !== null)
  expect(call).toBeDefined()
  return call![0] as Record<string, unknown>
}

describe('node dispatcher', () => {
  const globals = globalThis as Record<symbol, unknown>
  const installedDispatcher = globals[UNDICI_GLOBAL_DISPATCHER]

  afterEach(() => {
    vi.restoreAllMocks()
    globals[UNDICI_GLOBAL_DISPATCHER] = installedDispatcher
  })

  it('gives each connect attempt a budget that outlasts a long-haul handshake', async () => {
    const spy = vi.spyOn(net, 'connect')

    await withServer(async (url) => {
      const response = await fetchWithConnectTimeout(url, { method: 'GET', headers: {} })

      expect(response.status).toBe(200)
      expect(connectOptions(spy).autoSelectFamilyAttemptTimeout).toBe(DEFAULT_CONNECT_TIMEOUT)
    })
  })

  it('honours a caller-supplied connect timeout', async () => {
    const spy = vi.spyOn(net, 'connect')

    await withServer(async (url) => {
      const response = await fetchWithConnectTimeout(url, { method: 'GET', headers: {} }, 7500)

      expect(response.status).toBe(200)
      expect(connectOptions(spy).autoSelectFamilyAttemptTimeout).toBe(7500)
    })
  })

  it('falls back to the default budget for a timeout that is not usable', () => {
    expect(resolveDispatcher(0)).toBe(resolveDispatcher())
    expect(resolveDispatcher(-1)).toBe(resolveDispatcher())
    expect(resolveDispatcher(NaN)).toBe(resolveDispatcher())
    expect(resolveDispatcher(0.1)).toBe(resolveDispatcher())
    expect(resolveDispatcher(Infinity)).toBe(resolveDispatcher())
    expect(resolveDispatcher(2147483648)).toBe(resolveDispatcher())
    expect(resolveDispatcher(Object(2000) as number)).toBe(resolveDispatcher())
  })

  it('still sends the request when the configured timeout is not usable', async () => {
    const spy = vi.spyOn(net, 'connect')

    await withServer(async (url) => {
      const response = await fetchWithConnectTimeout(url, { method: 'GET', headers: {} }, 0.1)

      expect(response.status).toBe(200)
      expect(connectOptions(spy).autoSelectFamilyAttemptTimeout).toBe(DEFAULT_CONNECT_TIMEOUT)
    })
  })

  it('reuses one agent per connect timeout', () => {
    expect(resolveDispatcher(1234)).toBe(resolveDispatcher(1234))
    expect(resolveDispatcher(1234)).not.toBe(resolveDispatcher(4321))
  })

  it('leaves a proxy dispatcher in charge of the request', () => {
    class ProxyAgent {}
    globals[UNDICI_GLOBAL_DISPATCHER] = new ProxyAgent()

    expect(resolveDispatcher()).toBeUndefined()
  })

  it('leaves an agent the application installed in charge of the request', async () => {
    const spy = vi.spyOn(net, 'connect')
    setGlobalDispatcher(new Agent({ connect: { autoSelectFamilyAttemptTimeout: 1234 } }))

    expect(resolveDispatcher()).toBeUndefined()

    await withServer(async (url) => {
      const response = await fetchWithConnectTimeout(url, { method: 'GET', headers: {} })

      expect(response.status).toBe(200)
      expect(connectOptions(spy).autoSelectFamilyAttemptTimeout).toBe(1234)
    })
  })
})
