import type { ContextData } from '@/extensions/context/types'

async function loadTwoModuleCopies() {
  vi.resetModules()
  const first = await import('@/extensions/context/lifetime')
  vi.resetModules()
  const second = await import('@/extensions/context/lifetime')
  return { first, second }
}

describe('context lifetimes', () => {
  it('share one registry across module copies', async () => {
    const copies = await loadTwoModuleCopies()
    expect(copies.second).not.toBe(copies.first)
    const controller = new AbortController()

    const context: ContextData = copies.first.inheritContextLifetime(undefined, {}, controller.signal)
    const signal = copies.second.getContextLifetimeSignal(context)
    controller.abort()

    expect(signal?.aborted).toBe(true)
    expect(copies.second.isContextActive(context)).toBe(false)
  })
})
