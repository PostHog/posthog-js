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
            sessionId: undefined,
            deviceId: 'device_abc',
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
            sessionId: undefined,
            deviceId: 'device_abc',
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
            sessionId: undefined,
            deviceId: 'device_abc',
        })
    })

    it('extracts sessionId from $sesid array', () => {
        const cookieValue = JSON.stringify({
            distinct_id: 'user_123',
            $device_id: 'device_abc',
            $sesid: [1708700000000, 'session-uuid-v7', 1708700000000],
        })
        const result = parsePostHogCookie(cookieValue)
        expect(result).toEqual({
            distinctId: 'user_123',
            isIdentified: false,
            sessionId: 'session-uuid-v7',
            deviceId: 'device_abc',
        })
    })

    it('returns undefined sessionId when $sesid is missing', () => {
        const cookieValue = JSON.stringify({
            distinct_id: 'user_123',
            $device_id: 'device_abc',
        })
        const result = parsePostHogCookie(cookieValue)
        expect(result?.sessionId).toBeUndefined()
    })

    it('returns undefined sessionId when $sesid is not an array', () => {
        const cookieValue = JSON.stringify({
            distinct_id: 'user_123',
            $sesid: 'not-an-array',
        })
        const result = parsePostHogCookie(cookieValue)
        expect(result?.sessionId).toBeUndefined()
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
    it('produces JSON with distinct_id, $device_id, and $sesid', () => {
        const result = serializePostHogCookie('abc-123')
        const parsed = JSON.parse(result)
        expect(parsed.distinct_id).toBe('abc-123')
        expect(parsed.$device_id).toBe('abc-123')
        expect(parsed.$user_state).toBe('anonymous')
        expect(parsed.$sesid).toHaveLength(3)
        expect(typeof parsed.$sesid[0]).toBe('number')
        expect(typeof parsed.$sesid[1]).toBe('string')
        expect(parsed.$sesid[2]).toBe(parsed.$sesid[0])
    })

    it('roundtrips with parsePostHogCookie as anonymous with sessionId', () => {
        const serialized = serializePostHogCookie('anon-id')
        const parsed = parsePostHogCookie(serialized)
        expect(parsed?.distinctId).toBe('anon-id')
        expect(parsed?.isIdentified).toBe(false)
        expect(typeof parsed?.sessionId).toBe('string')
    })
})
