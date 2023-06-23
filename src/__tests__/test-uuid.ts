import { _UUID } from '../utils'
import { UUID, uuidv7 } from '../uuidv7'

describe('uuid', () => {
    beforeEach(() => {
        console.warn = (message) => {
            // don't allow standard throw on warn
            console.info('saw expected console warning:', message)
        }
    })
    it('should be a uuid when requested', () => {
        expect(_UUID('v7')).toHaveLength(36)
    })

    it('generates many unique ids in a reasonable time', () => {
        const ids = Array.from({ length: 500_000 }, () => _UUID('v7'))
        expect(new Set(ids).size).toBe(ids.length)
    })

    it('by default should be the format we have used forever', () => {
        expect(_UUID()?.length).toBeGreaterThanOrEqual(52)
    })

    it('does not have a reported bug with fromStaticFields', () => {
        // in https://github.com/PostHog/posthog-js/issues/710 we see a page
        // where multiple trackers (or the application code itself)
        // has overriden Date.now() and we receive a Date object not a number
        // this causes us to throw which we don't want

        Date.now = jest
            .spyOn(Date, 'now')
            .mockImplementation(
                () => new Date('2023-01-01T00:00:00.000Z') as unknown as number
            ) as unknown as () => number

        expect(() => uuidv7()).not.toThrow()
    })
})
