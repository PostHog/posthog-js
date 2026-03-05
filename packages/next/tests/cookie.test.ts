import {
    getPostHogCookieName,
    parsePostHogCookie,
    serializePostHogCookie,
    getConsentCookieName,
    isOptedOut,
} from '../src/shared/cookie'

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

describe('getConsentCookieName', () => {
    it('returns default name with __ph_opt_in_out_ prefix', () => {
        expect(getConsentCookieName('phc_abc123')).toBe('__ph_opt_in_out_phc_abc123')
    })

    it('uses consent_persistence_name when provided', () => {
        expect(getConsentCookieName('phc_abc123', { consent_persistence_name: 'my_consent' })).toBe('my_consent')
    })

    it('uses opt_out_capturing_cookie_prefix + apiKey when provided', () => {
        expect(getConsentCookieName('phc_abc123', { opt_out_capturing_cookie_prefix: 'custom_' })).toBe(
            'custom_phc_abc123'
        )
    })

    it('prefers consent_persistence_name over opt_out_capturing_cookie_prefix', () => {
        expect(
            getConsentCookieName('phc_abc123', {
                consent_persistence_name: 'my_consent',
                opt_out_capturing_cookie_prefix: 'custom_',
            })
        ).toBe('my_consent')
    })
})

describe('isOptedOut', () => {
    const makeCookies = (entries: Record<string, string>) => ({
        get: (name: string) => {
            const value = entries[name]
            return value !== undefined ? { name, value } : undefined
        },
    })

    it('returns false when no consent cookie and opt_out_by_default is false', () => {
        expect(isOptedOut(makeCookies({}), 'phc_test')).toBe(false)
    })

    it('returns true when no consent cookie and opt_out_by_default is true', () => {
        expect(isOptedOut(makeCookies({}), 'phc_test', { opt_out_capturing_by_default: true })).toBe(true)
    })

    it('returns false when consent cookie is 1 (opted in)', () => {
        expect(isOptedOut(makeCookies({ __ph_opt_in_out_phc_test: '1' }), 'phc_test')).toBe(false)
    })

    it('returns true when consent cookie is 0 (opted out)', () => {
        expect(isOptedOut(makeCookies({ __ph_opt_in_out_phc_test: '0' }), 'phc_test')).toBe(true)
    })

    it('returns false for yes-like values (true, yes)', () => {
        expect(isOptedOut(makeCookies({ __ph_opt_in_out_phc_test: 'true' }), 'phc_test')).toBe(false)
        expect(isOptedOut(makeCookies({ __ph_opt_in_out_phc_test: 'yes' }), 'phc_test')).toBe(false)
    })

    it('returns true for no-like values (false, no)', () => {
        expect(isOptedOut(makeCookies({ __ph_opt_in_out_phc_test: 'false' }), 'phc_test')).toBe(true)
        expect(isOptedOut(makeCookies({ __ph_opt_in_out_phc_test: 'no' }), 'phc_test')).toBe(true)
    })

    it('uses custom consent_persistence_name', () => {
        const cookies = makeCookies({ my_consent: '0' })
        expect(isOptedOut(cookies, 'phc_test', { consent_persistence_name: 'my_consent' })).toBe(true)
    })

    it('explicit opt-in overrides opt_out_by_default', () => {
        const cookies = makeCookies({ __ph_opt_in_out_phc_test: '1' })
        expect(isOptedOut(cookies, 'phc_test', { opt_out_capturing_by_default: true })).toBe(false)
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
