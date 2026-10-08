import { uuid7ToTimestampMs, uuidv7 } from '@posthog/browser-common/utils/uuidv7'
afterEach(() => {
    vi.useRealTimers()
})
describe('uuid', () => {
    it('should be a uuid when requested', () => {
        expect(uuidv7()).toHaveLength(36)
        expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
        expect(uuidv7()).not.toEqual(uuidv7())
    })
    describe('uuid7ToTimestampMs', () => {
        it('should convert a UUIDv7 generated with uuidv7() to a timestamp', async () => {
            vi.useFakeTimers()
            vi.setSystemTime(1718728476965)
            vi.resetModules()
            const fresh = await import('@posthog/browser-common/utils/uuidv7')
            expect(uuid7ToTimestampMs(fresh.uuidv7())).toBe(1718728476965)
        })
        it('should convert a known UUIDv7 to a known timestamp', () => {
            const uuid = '01902c33-4925-7f20-818a-4095f9251383'
            const timestamp = uuid7ToTimestampMs(uuid)
            const expected = new Date('Tue, 18 Jun 2024 16:34:36.965 GMT').getTime()
            expect(timestamp).toBe(expected)
        })
    })
})
