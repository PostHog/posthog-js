import type { PostHogBackendClient } from '@/client'

async function loadTwoModuleCopies() {
  vi.resetModules()
  const first = await import('@/extensions/context/listeners')
  vi.resetModules()
  const second = await import('@/extensions/context/listeners')
  return { first, second }
}

describe('context listeners', () => {
  it.each([
    ['the listener', 'second', 'first'],
    ['the notifier', 'first', 'second'],
  ] as const)('share one registry when %s comes from another module copy', async (_, adder, notifier) => {
    const copies = await loadTwoModuleCopies()
    expect(copies.second).not.toBe(copies.first)
    const client = {} as PostHogBackendClient
    const listener = vi.fn()

    const unsubscribe = copies[adder].addContextListener(client, listener)
    copies[notifier].enrichCurrentSpan(client)
    unsubscribe()
    copies[notifier].enrichCurrentSpan(client)

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(true)
  })
})
