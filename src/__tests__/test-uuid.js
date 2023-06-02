import { _UUID } from '../utils'

describe('uuid', () => {
    it('should be a uuid when requested', () => {
        // the most thorough test case it is possible to write
        expect(_UUID('v7')).toHaveLength(36)
    })

    it('by default should be the format we have used forever', () => {
        expect(_UUID().length).toBeGreaterThanOrEqual(52)
    })
})
