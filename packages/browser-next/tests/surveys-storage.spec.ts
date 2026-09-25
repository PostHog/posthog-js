import type { KeyValueStore } from '@posthog/browser-common'
import { SurveysStorage } from '../src/surveys-storage'

const makeStore = () => {
    const values = new Map<string, unknown>()
    const kv = {
        get: vi.fn((key: string) => values.get(key)),
        set: vi.fn((key: string, value: unknown) => values.set(key, value)),
        remove: vi.fn((key: string) => values.delete(key)),
    } as unknown as KeyValueStore
    return { values, kv, store: new SurveysStorage(kv) }
}

describe('SurveysStorage', () => {
    it('stores renderer strings verbatim in the supplied KV namespace', () => {
        const { kv, store } = makeStore()
        const value = JSON.stringify({ answer: 'yes' })
        store.setItem('progress', value)
        expect(kv.set).toHaveBeenCalledWith('progress', value)
        expect(store.getItem('progress')).toBe(value)
        store.removeItem('progress')
        expect(kv.remove).toHaveBeenCalledWith('progress')
        expect(store.getItem('progress')).toBeNull()
    })

    it('reads current host state rather than retaining a second cache', () => {
        const { values, store } = makeStore()
        values.set('seen', 'true')
        expect(store.getItem('seen')).toBe('true')
        values.clear()
        expect(store.getItem('seen')).toBeNull()
    })

    it('does not expose structured KV values as renderer strings', () => {
        const { values, store } = makeStore()
        values.set('definitions', [{ id: 'survey' }])
        expect(store.getItem('definitions')).toBeNull()
    })
})
