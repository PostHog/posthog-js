import { findToolOwnership } from '../extensions/tool-schema'

describe('cold tool schema lookup', () => {
  it('follows pagination and preserves application-owned arguments', async () => {
    const list = vi.fn(async (cursor?: string) =>
      cursor
        ? {
            tools: [
              {
                name: 'echo',
                inputSchema: {
                  type: 'object',
                  properties: { llm_model: { type: 'string' }, conversation_id: { type: 'string' } },
                },
              },
            ],
          }
        : { tools: [], nextCursor: 'next' }
    )
    expect(await findToolOwnership('echo', list)).toMatchObject({ llmModel: false, conversationId: false })
    expect(list.mock.calls).toEqual([[undefined], ['next']])
  })

  it.each(['cycle', 'endless', 'malformed'] as const)('bounds %s catalogs', async (mode) => {
    let calls = 0
    const list = vi.fn(async () => {
      calls++
      return mode === 'malformed' ? {} : { tools: [], nextCursor: mode === 'cycle' ? 'same' : String(calls) }
    })
    expect(await findToolOwnership('absent', list)).toBeUndefined()
    expect(calls).toBe(mode === 'cycle' ? 2 : mode === 'endless' ? 16 : 1)
  })

  it('stops waiting after 250ms and does not follow late pages', async () => {
    vi.useFakeTimers()
    try {
      let finish!: (value: unknown) => void
      const list = vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve
          })
      )
      const pending = findToolOwnership('echo', list)
      await vi.advanceTimersByTimeAsync(250)
      expect(await pending).toBeUndefined()
      finish({ tools: [], nextCursor: 'late' })
      await Promise.resolve()
      expect(list).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
