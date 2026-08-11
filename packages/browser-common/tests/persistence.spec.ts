import { InMemoryKeyValueStore } from './helpers/test-client'

describe('InMemoryKeyValueStore', () => {
    it('initializes synchronously and stores nullish values until removal', () => {
        const kv = new InMemoryKeyValueStore()

        expect(kv.initialize()).toBeUndefined()
        kv.set('state', null)
        expect(kv.get('state')).toBeNull()

        kv.set('state', undefined)
        expect(kv.get('state')).toBeUndefined()
        expect(kv['_values'].has('state')).toBe(true)

        kv.set('state', 'present')
        kv.remove('state')
        expect(kv.get('state')).toBeUndefined()
    })

    it('gets, sets, and removes related values in batches', () => {
        const kv = new InMemoryKeyValueStore()

        kv.set({ first: true, second: 'value', undefinedValue: undefined })
        expect(
            kv.get<{ first: boolean; second: string; missing: unknown; undefinedValue: undefined }>([
                'first',
                'missing',
                'second',
                'undefinedValue',
            ])
        ).toEqual({
            first: true,
            second: 'value',
        })

        kv.remove(['first', 'second'])
        expect(kv.get<{ first: boolean; second: string }>(['first', 'second'])).toEqual({})
    })
})
