import { InMemoryKeyValueStore } from './helpers/test-client'

describe('InMemoryKeyValueStore', () => {
    it('stores nullish values and only deletes through remove', async () => {
        const kv = new InMemoryKeyValueStore()

        await kv.set('state', null)
        await expect(kv.get('state')).resolves.toBeNull()

        await kv.set('state', undefined)
        await expect(kv.get('state')).resolves.toBeUndefined()
        expect(kv['_values'].has('state')).toBe(true)

        await kv.set('state', 'present')
        await kv.remove('state')
        await expect(kv.get('state')).resolves.toBeUndefined()
    })
})
