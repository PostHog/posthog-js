import { getPostHogCookieName, parsePostHogCookie, serializePostHogCookie } from '../src/shared/cookie'

describe('getPostHogCookieName', () => {
    it('returns correct cookie name for a simple API key', () => {
        expect(getPostHogCookieName('phc_abc123')).toBe('ph_phc_abc123_posthog')
    })

    it('sanitizes + in token', () => {
        expect(getPostHogCookieName('abc+def')).toBe('ph_abcPLdef_posthog')
    })

    it('sanitizes / in token', () => {
        expect(getPostHogCookieName('abc/def')).toBe('ph_abcSLdef_posthog')
    })

    it('sanitizes = in token', () => {
        expect(getPostHogCookieName('abc=def')).toBe('ph_abcEQdef_posthog')
    })

    it('sanitizes multiple special characters', () => {
        expect(getPostHogCookieName('a+b/c=d')).toBe('ph_aPLbSLcEQd_posthog')
    })
})

describe('parsePostHogCookie', () => {
    it('parses an identified user cookie', () => {
        const cookieValue = JSON.stringify({
            distinct_id: 'user_123',
            $device_id: 'device_abc',
            $user_state: 'identified',
        })
        const result = parsePostHogCookie(cookieValue)
        expect(result).toEqual({
            distinctId: 'user_123',
            isIdentified: true,
        })
    })

    it('detects anonymous users', () => {
        const cookieValue = JSON.stringify({
            distinct_id: 'device_abc',
            $device_id: 'device_abc',
            $user_state: 'anonymous',
        })
        const result = parsePostHogCookie(cookieValue)
        expect(result).toEqual({
            distinctId: 'device_abc',
            isIdentified: false,
        })
    })

    it('treats missing $user_state as anonymous', () => {
        const cookieValue = JSON.stringify({
            distinct_id: 'user_123',
            $device_id: 'device_abc',
        })
        const result = parsePostHogCookie(cookieValue)
        expect(result).toEqual({
            distinctId: 'user_123',
            isIdentified: false,
        })
    })

    it('returns null for empty string', () => {
        expect(parsePostHogCookie('')).toBeNull()
    })

    it('returns null for invalid JSON', () => {
        expect(parsePostHogCookie('not-json')).toBeNull()
    })

    it('returns null for JSON without distinct_id', () => {
        expect(parsePostHogCookie(JSON.stringify({ foo: 'bar' }))).toBeNull()
    })

    it('returns null for null input', () => {
        expect(parsePostHogCookie(null as unknown as string)).toBeNull()
    })
})

describe('serializePostHogCookie', () => {
    it('produces JSON with distinct_id and $device_id both set to the anonymous ID', () => {
        const result = serializePostHogCookie('abc-123')
        expect(JSON.parse(result)).toEqual({
            distinct_id: 'abc-123',
            $device_id: 'abc-123',
            $user_state: 'anonymous',
        })
    })

    it('roundtrips with parsePostHogCookie as anonymous', () => {
        const serialized = serializePostHogCookie('anon-id')
        const parsed = parsePostHogCookie(serialized)
        expect(parsed).toEqual({
            distinctId: 'anon-id',
            isIdentified: false,
        })
    })
})
