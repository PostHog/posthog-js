import { generateAnonymousId, identityToBootstrap } from '../src/shared/identity'

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

describe('identityToBootstrap', () => {
    it('maps provider identity to posthog-js bootstrap keys', () => {
        expect(
            identityToBootstrap({
                distinctId: 'user_123',
                isIdentified: true,
                sessionId: '0192ce4f-0000-7000-8000-000000000000',
            })
        ).toEqual({
            distinctID: 'user_123',
            isIdentifiedID: true,
            sessionID: '0192ce4f-0000-7000-8000-000000000000',
        })
    })

    it('preserves explicit anonymous identity state', () => {
        expect(identityToBootstrap({ distinctId: 'anon_123', isIdentified: false })).toEqual({
            distinctID: 'anon_123',
            isIdentifiedID: false,
        })
    })

    it('returns undefined without a distinct ID', () => {
        expect(identityToBootstrap()).toBeUndefined()
        expect(identityToBootstrap({ distinctId: '' })).toBeUndefined()
    })
})
