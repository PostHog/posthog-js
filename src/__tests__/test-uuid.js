import { _UUID } from '../utils'

describe('uuid', () => {
    it('should be a uuid when requested', () => {
        expect(_UUID('v7')).toHaveLength(36)
    })

    it('generates many unique ids in a reasonable time', () => {
        const ids = Array.from({ length: 500_000 }, () => _UUID('v7'))
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('by default should be the format we have used forever', () => {
        expect(_UUID().length).toBeGreaterThanOrEqual(52)
    })

    it('generates different UUIDs when window.performance is available', () => {
        const uuids = Array.from({ length: 500 }, () => _UUID())

        expect(new Set(uuids).size).toBe(uuids.length)

        for (const uuid of uuids) {
            // both the first and last value are based on time, but we want them to be different
            const parts = uuid.split('-')
            const first = parts[0]
            const last = parts[parts.length - 1]
            expect(first).not.toBe(last)
        }
    })
})
