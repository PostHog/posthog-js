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
})
