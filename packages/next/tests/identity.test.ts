import { generateAnonymousId } from '../src/shared/identity'

const UUIDV7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('generateAnonymousId', () => {
    it('returns a valid UUIDv7 string', () => {
        const id = generateAnonymousId()
        expect(id).toMatch(UUIDV7_REGEX)
    })

    it('generates unique IDs', () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateAnonymousId()))
        expect(ids.size).toBe(100)
    })
})
