import { DEFAULT_API_HOST } from '../src/shared/constants'
import {
    getProjectTokenOption,
    normalizeConfigValue,
    resolveHostOrDefault,
    resolveProjectToken,
} from '../src/shared/config'

describe('shared config', () => {
    const originalEnv = process.env

    beforeEach(() => {
        vi.clearAllMocks()
        process.env = { ...originalEnv }
        delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
        delete process.env.NEXT_PUBLIC_POSTHOG_KEY
        delete process.env.NEXT_PUBLIC_POSTHOG_HOST
    })

    afterAll(() => {
        process.env = originalEnv
    })

    it('normalizes strings and returns undefined for non-strings', () => {
        expect(normalizeConfigValue('  phc_test123\n')).toBe('phc_test123')
        expect(normalizeConfigValue('   ')).toBeUndefined()
        expect(normalizeConfigValue(undefined)).toBeUndefined()
        expect(normalizeConfigValue(null)).toBeUndefined()
        expect(normalizeConfigValue(123)).toBeUndefined()
        expect(normalizeConfigValue({ value: 'phc_test123' })).toBeUndefined()
    })

    it('warns and returns undefined when projectToken is not a string and no env fallback exists', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation()

        expect(resolveProjectToken({ value: 'phc_test123' })).toBeUndefined()

        expect(warnSpy).toHaveBeenCalledWith(
            '[PostHog Next.js] projectToken is required — set NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN or pass projectToken. PostHog will not be initialized'
        )
        warnSpy.mockRestore()
    })

    it('falls back to env projectToken when explicit projectToken is not a string', () => {
        process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = '  phc_from_env\n'

        expect(resolveProjectToken({ value: 'phc_test123' })).toBe('phc_from_env')
    })

    it.each([
        ['NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN only', { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_token' }, 'phc_token'],
        ['legacy NEXT_PUBLIC_POSTHOG_KEY only', { NEXT_PUBLIC_POSTHOG_KEY: 'phc_legacy' }, 'phc_legacy'],
        [
            'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN over NEXT_PUBLIC_POSTHOG_KEY',
            { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: 'phc_token', NEXT_PUBLIC_POSTHOG_KEY: 'phc_legacy' },
            'phc_token',
        ],
        [
            'legacy NEXT_PUBLIC_POSTHOG_KEY when NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is blank',
            { NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: '  ', NEXT_PUBLIC_POSTHOG_KEY: 'phc_legacy' },
            'phc_legacy',
        ],
    ])('resolves the project token from %s', (_case, env, expected) => {
        Object.assign(process.env, env)

        expect(resolveProjectToken(undefined)).toBe(expected)
    })

    it('prefers an explicit project token over env vars', () => {
        process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = 'phc_token'
        process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_legacy'

        expect(resolveProjectToken('phc_explicit')).toBe('phc_explicit')
    })

    it.each([
        ['projectToken', { projectToken: 'phc_token' }, 'phc_token'],
        ['deprecated apiKey', { apiKey: 'phc_legacy' }, 'phc_legacy'],
        ['projectToken over apiKey', { projectToken: 'phc_token', apiKey: 'phc_legacy' }, 'phc_token'],
        ['apiKey when projectToken is blank', { projectToken: '', apiKey: 'phc_legacy' }, 'phc_legacy'],
        ['neither', {}, undefined],
    ])('reads the project token option from %s', (_case, options, expected) => {
        expect(getProjectTokenOption(options)).toBe(expected)
    })

    it('uses the default host when explicit and env hosts are not strings', () => {
        process.env.NEXT_PUBLIC_POSTHOG_HOST = ''

        expect(resolveHostOrDefault({ value: 'https://custom.posthog.com' })).toBe(DEFAULT_API_HOST)
    })
})
