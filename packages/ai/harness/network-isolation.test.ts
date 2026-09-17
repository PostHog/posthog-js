import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { expect, it } from 'vitest'

it.skipIf(process.env.REQUIRE_OFFLINE !== '1')('denies external connections at the network boundary', async () => {
  const interfaces = Object.values(networkInterfaces()).flatMap((addresses) => addresses ?? [])
  expect(interfaces.length).toBeGreaterThan(0)
  expect(interfaces.every((address) => address.internal)).toBe(true)

  const code = await new Promise<string | undefined>((resolve, reject) => {
    const socket = connect({ host: '1.1.1.1', port: 443 })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('External connection timed out; timeout does not prove network isolation'))
    }, 2000)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      reject(new Error('External connection succeeded during offline replay'))
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      socket.destroy()
      resolve(error.code)
    })
  })
  expect(code).toBe('ENETUNREACH')
})
