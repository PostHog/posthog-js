import { _UUID } from '../utils'

describe('uuid', () => {
    let originalUUIDFn = _UUID('og')
    let v7UUIDFn = _UUID('v7')
    let defaultUUIDFn = _UUID()

    it('should be a uuid when requested', () => {
        expect(v7UUIDFn()).toHaveLength(36)
    })

    it('by default should be the format we have used forever', () => {
        expect(defaultUUIDFn().length).toBeGreaterThanOrEqual(52)
    })

    it('using window.performance for UUID still generates differing time parts of default UUID', () => {
        const uuids = Array.from({ length: 1000 }, () => originalUUIDFn())

        for (const uuid of uuids) {
            // both the first and last value are based on time, but we want them to be different
            const parts = uuid.split('-')
            const first = parts[0]
            const last = parts[parts.length - 1]
            expect(first).not.toBe(last)
        }
    })
})
