import { detachedSnapshot } from '../../src/utils/detached-snapshot'

describe('detachedSnapshot', () => {
    it('returns primitives unchanged', () => {
        expect(detachedSnapshot(undefined)).toBeUndefined()
        expect(detachedSnapshot(null)).toBeNull()
        expect(detachedSnapshot('value')).toBe('value')
    })

    it('recursively detaches objects, arrays, and dates', () => {
        const value = {
            nested: { enabled: true },
            items: [{ count: 1 }],
            timestamp: new Date('2026-01-01T00:00:00Z'),
        }

        const snapshot = detachedSnapshot(value)

        expect(snapshot).toEqual(value)
        expect(snapshot).not.toBe(value)
        expect(snapshot.nested).not.toBe(value.nested)
        expect(snapshot.items).not.toBe(value.items)
        expect(snapshot.items[0]).not.toBe(value.items[0])
        expect(snapshot.timestamp).not.toBe(value.timestamp)
    })

    it('preserves cycles within each independent snapshot', () => {
        const value: { name: string; self?: unknown } = { name: 'value' }
        value.self = value

        const first = detachedSnapshot(value)
        const second = detachedSnapshot(value)

        expect(first.self).toBe(first)
        expect(second.self).toBe(second)
        expect(first).not.toBe(second)
    })
})
