import { uuid7ToTimestampMs, uuidv7 } from '../uuidv7'
const TEN_SECONDS = 10_000
describe('uuid', () => {
    it('should be a uuid when requested', () => {
        expect(uuidv7()).toHaveLength(36)
        expect(uuidv7()).not.toEqual(uuidv7())
    })
    describe('uuid7ToTimestampMs', () => {
        it('should convert a UUIDv7 generated with uuidv7() to a timestamp', () => {
            const uuid = uuidv7()
            const timestamp = uuid7ToTimestampMs(uuid)
            const now = Date.now()
            expect(typeof timestamp).toBe('number')
            expect(timestamp).toBeLessThan(now + TEN_SECONDS)
            expect(timestamp).toBeGreaterThan(now - TEN_SECONDS)
        })
        it('should convert a known UUIDv7 to a known timestamp', () => {
            const uuid = '01902c33-4925-7f20-818a-4095f9251383'
            const timestamp = uuid7ToTimestampMs(uuid)
            const expected = new Date('Tue, 18 Jun 2024 16:34:36.965 GMT').getTime()
            expect(timestamp).toBe(expected)
        })
    })
})
