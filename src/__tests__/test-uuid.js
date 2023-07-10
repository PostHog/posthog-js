import { _UUID } from '../utils'

describe('uuid', () => {
    it('should be a uuid when requested', () => {
        expect(_UUID('v7')).toHaveLength(36)
    })

    it('generates many unique v7 UUIDs in a reasonable time', () => {
        const ids = Array.from({ length: 500_000 }, () => _UUID('v7'))
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('generates many unique OG UUIDs in a reasonable time', () => {
        const ids = Array.from({ length: 500_000 }, () => _UUID())
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('by default should be the format we have used forever', () => {
        expect(_UUID().length).toBeGreaterThanOrEqual(52)
    })

    it('using window.performance for UUID still generates differing time parts of OG UUID', () => {
        const uuids = Array.from({ length: 1000 }, () => _UUID())

        for (const uuid of uuids) {
            // both the first and last value are based on time, but we want them to be different
            const parts = uuid.split('-')
            const first = parts[0]
            const last = parts[parts.length - 1]
            expect(first).not.toBe(last)
        }
    })
})
