import { createKeyValueStore, TabValues } from '../src/core/state/key-value-store'
import { MemoryStorage } from './helpers'
import { BrowserState } from '../src/core/state/state'

describe('core scoped KV mechanisms', () => {
    it('keeps copied methods bound, snapshots values and omits missing batch keys', () => {
        const values: Record<string, unknown> = Object.create(null)
        const save = vi.fn()
        let active = true
        const store = createKeyValueStore({ values: () => values, save, canAccess: () => active })
        const copy = { ...store }
        const input = { nested: true }
        copy.set({ first: input, second: 2 })
        input.nested = false
        expect(copy.get(['first', 'missing', 'second'])).toEqual({ first: { nested: true }, second: 2 })
        copy.set('second', undefined)
        expect(copy.get(['missing', 'second'])).toEqual({})
        copy.remove(['first', 'second'])
        expect(copy.get('first')).toBeUndefined()
        save.mockClear()
        active = false
        copy.set('blocked', true)
        copy.remove('blocked')
        expect(copy.get(['blocked'])).toEqual({})
        expect(save).not.toHaveBeenCalled()
    })

    it.each(['["unexpected"]', '"unexpected"', 'null', 'invalid json'])(
        'recovers an invalid tab namespace without retaining malformed fields: %s',
        (raw) => {
            const storage = new MemoryStorage()
            storage.setItem('namespace', raw)
            const buffer = new TabValues('namespace', () => storage)
            const store = createKeyValueStore({
                values: () => buffer.values(),
                save: () => buffer.save(),
                canAccess: () => true,
            })
            expect(store.get('0')).toBeUndefined()
            store.set('valid', true)
            expect(store.get('valid')).toBe(true)
            if (raw !== 'invalid json')
                expect(JSON.parse(storage.getItem('namespace') ?? '{}')).toEqual({ valid: true })
        }
    )

    it.each(['unavailable', 'throw'] as const)(
        'preserves completed nested values when storage resolution is %s',
        (completion) => {
            const storage = new MemoryStorage()
            storage.setItem('namespace', JSON.stringify({ nested: 'stale', retained: true }))
            let armed = true
            let callbacks = 0
            const buffer = new TabValues('namespace', () => {
                if (!armed) return storage
                armed = false
                callbacks++
                store.set('nested', true)
                if (completion === 'throw') throw new Error('Provider failed after nested mutation')
                return undefined
            })
            const store = createKeyValueStore({
                values: () => buffer.values(),
                save: () => buffer.save(),
                canAccess: () => true,
            })
            store.set('outer', true)
            expect(callbacks).toBe(1)
            expect(store.get(['nested', 'outer', 'retained'])).toEqual({ nested: true, outer: true, retained: true })
        }
    )

    it('keeps tab values usable when native writes fail', () => {
        const storage = new MemoryStorage()
        const buffer = new TabValues('namespace', () => storage)
        const store = createKeyValueStore({
            values: () => buffer.values(),
            save: () => buffer.save(),
            canAccess: () => true,
        })
        vi.spyOn(storage, 'setItem').mockImplementation(() => {
            throw new Error('quota')
        })
        expect(() => store.set('value', true)).not.toThrow()
        expect(store.get('value')).toBe(true)
    })
})

describe('Core-provided persistent and tab KV views', () => {
    it.each(['persistent', 'tab'] as const)('%s views have own bound methods and isolated JSON values', (kind) => {
        const local = new MemoryStorage()
        const tab = new MemoryStorage()
        const state = new BrowserState(
            'ph_kv',
            local,
            undefined,
            undefined,
            false,
            () => tab,
            () => {}
        )
        const store =
            kind === 'persistent' ? state.keyValueStore('analytics') : state.tabKeyValueStore('analytics', () => true)
        expect(Object.keys(store).sort()).toEqual(['get', 'initialize', 'remove', 'set'])
        const copied = { ...store }
        const { get, set, remove, initialize } = copied
        initialize()
        const input = { nested: { count: 1 } }
        set('value', input)
        input.nested.count = 2
        const read = get<typeof input>('value')
        expect(read).toEqual({ nested: { count: 1 } })
        if (read === undefined) throw new Error('Expected stored value')
        read.nested.count = 3
        const batch = get<{ value: typeof input; missing: boolean }>(['value', 'missing'])
        expect(batch).toEqual({ value: { nested: { count: 1 } } })
        if (batch.value === undefined) throw new Error('Expected batch value')
        batch.value.nested.count = 4
        expect(get('value')).toEqual({ nested: { count: 1 } })
        set(JSON.parse('{"__proto__":{"own":true},"constructor":"application","prototype":"own"}'))
        expect(get('__proto__')).toEqual({ own: true })
        expect(get('constructor')).toBe('application')
        expect(get('prototype')).toBe('own')
        expect(get('toString')).toBeUndefined()
        set({ nullable: null, removed: true })
        set('removed', undefined)
        expect(get('nullable')).toBeNull()
        expect(get(['removed', 'missing'])).toEqual({})
        remove(['__proto__', 'value'])
        expect(get('__proto__')).toBeUndefined()
        expect(get('value')).toBeUndefined()
        expect(({} as Record<string, unknown>).own).toBeUndefined()
        expect(state.session).toBeUndefined()
        if (kind === 'tab') {
            expect([...local.values.values()].join('')).not.toContain('nullable')
            expect([...tab.values.keys()]).toEqual(['ph_ph_kv_posthog_browser_v2_tab_analytics'])
        } else expect(tab.values.size).toBe(0)
        state.dispose()
    })

    it('does not resolve native tab storage before an authorized operation', () => {
        const storage = vi.fn(() => new MemoryStorage())
        const values = new TabValues('lazy', storage)
        let active = false
        const store = createKeyValueStore({
            values: () => values.values(),
            save: () => values.save(),
            canAccess: () => active,
        })
        store.initialize()
        store.set('blocked', true)
        store.remove('blocked')
        expect(store.get('blocked')).toBeUndefined()
        expect(storage).not.toHaveBeenCalled()
        active = true
        store.set('allowed', true)
        store.get('allowed')
        store.set('later', true)
        expect(storage).toHaveBeenCalledTimes(1)
    })
})
