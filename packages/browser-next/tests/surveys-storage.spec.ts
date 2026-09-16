// @vitest-environment jsdom
import { SurveysStorage } from '../src/surveys-storage'
import { MemoryStorage } from './helpers'

const host = (storage = new MemoryStorage(), key = 'surveys') => ({ storage, key, onSession: () => ({ dispose() {} }) })

describe('SurveysStorage', () => {
    it('keeps memory-only clients isolated and never accesses native storage', () => {
        const read = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
            throw new Error('native storage')
        })
        try {
            const first = new SurveysStorage(undefined)
            const second = new SurveysStorage(undefined)
            first.setItem('seen', 'true')
            expect(first.getItem('seen')).toBe('true')
            expect(second.getItem('seen')).toBeNull()
            expect(read).not.toHaveBeenCalled()
        } finally {
            read.mockRestore()
        }
    })

    it('merges disjoint sequential tab writes against the latest product record', () => {
        const config = host()
        const first = new SurveysStorage(config)
        const second = new SurveysStorage(config)
        first.setItem('first', 'true')
        second.setItem('second', 'true')
        expect(first.getItem('second')).toBe('true')
        second.removeItem('first')
        first.setItem('third', 'true')
        expect(second.getItem('first')).toBeNull()
        expect(second.getItem('third')).toBe('true')
    })

    it.each(['getItem', 'setItem'] as const)('retains in-memory state after %s fails', (method) => {
        const config = host()
        const store = new SurveysStorage(config)
        store.setItem('before', 'old')
        config.storage[method] = () => {
            throw new Error('blocked')
        }
        store.setItem('after', 'new')
        expect(store.getItem('before')).toBe('old')
        expect(store.getItem('after')).toBe('new')
    })

    it('clears only its own record on reset and prevents writes after disposal', () => {
        const config = host()
        const store = new SurveysStorage(config)
        config.storage.setItem('core', 'unrelated')
        store.kv.set({ cache: [1], optional: undefined })
        expect(store.kv.get('cache')).toEqual([1])
        store.reset()
        expect(store.kv.get('cache')).toBeUndefined()
        expect(config.storage.getItem('core')).toBe('unrelated')
        store.dispose()
        store.setItem('late', 'true')
        expect(store.getItem('late')).toBeNull()
    })
})
