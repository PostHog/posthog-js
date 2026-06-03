import { IdentityCache } from '../extensions/internal'

describe('IdentityCache', () => {
  it('stores and retrieves identities by session id', () => {
    const cache = new IdentityCache()
    cache.set('ses_1', { distinctId: 'a' })
    expect(cache.get('ses_1')).toEqual({ distinctId: 'a' })
    expect(cache.get('missing')).toBeUndefined()
  })

  it('is bounded: evicts the least-recently-used entry past maxSize', () => {
    const cache = new IdentityCache(2)
    cache.set('ses_1', { distinctId: 'a' })
    cache.set('ses_2', { distinctId: 'b' })
    // Touch ses_1 so ses_2 becomes least-recently-used.
    cache.get('ses_1')
    cache.set('ses_3', { distinctId: 'c' })

    expect(cache.size()).toBe(2)
    expect(cache.get('ses_2')).toBeUndefined()
    expect(cache.get('ses_1')).toEqual({ distinctId: 'a' })
    expect(cache.get('ses_3')).toEqual({ distinctId: 'c' })
  })

  it('keeps instances independent so identities never bleed across servers', () => {
    const serverA = new IdentityCache()
    const serverB = new IdentityCache()
    serverA.set('ses_shared', { distinctId: 'from-a' })

    expect(serverA.get('ses_shared')).toEqual({ distinctId: 'from-a' })
    expect(serverB.get('ses_shared')).toBeUndefined()
  })
})
