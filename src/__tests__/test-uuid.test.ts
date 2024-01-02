import { uuidv7 } from '../uuidv7'

describe('uuid', () => {
    it('should be a uuid when requested', () => {
        expect(uuidv7()).toHaveLength(36)
        expect(uuidv7()).not.toEqual(uuidv7())
    })
})
