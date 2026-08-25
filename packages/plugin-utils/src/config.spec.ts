import { resolveConfig } from './config'

describe('resolveConfig', () => {
    it.each([
        {
            name: 'trims whitespace-sensitive config values',
            personalApiKey: '  phx_personal_key\n',
            host: '  https://eu.i.posthog.com/\t ',
            expectedPersonalApiKey: 'phx_personal_key',
            expectedHost: 'https://eu.i.posthog.com/',
        },
        {
            name: 'defaults a blank host after trimming whitespace',
            personalApiKey: 'phx_personal_key',
            host: ' \n\t ',
            expectedPersonalApiKey: 'phx_personal_key',
            expectedHost: 'https://us.i.posthog.com',
        },
    ])('{$name}', ({ personalApiKey, host, expectedPersonalApiKey, expectedHost }) => {
        const config = resolveConfig(
            {
                personalApiKey,
                projectId: 'project-id',
                host,
                cliBinaryPath: '/tmp/posthog-cli',
            },
            { defaultEnabled: false }
        )

        expect(config.personalApiKey).toBe(expectedPersonalApiKey)
        expect(config.host).toBe(expectedHost)
    })

    describe('releaseMode', () => {
        const originalEnv = process.env.POSTHOG_RELEASE_MODE

        afterEach(() => {
            if (originalEnv === undefined) {
                delete process.env.POSTHOG_RELEASE_MODE
            } else {
                process.env.POSTHOG_RELEASE_MODE = originalEnv
            }
        })

        it.each([
            { name: 'defaults to symbol-set', option: undefined, env: undefined, expected: 'symbol-set' },
            { name: 'reads POSTHOG_RELEASE_MODE', option: undefined, env: 'event', expected: 'event' },
            { name: 'prefers the explicit option', option: 'symbol-set', env: 'event', expected: 'symbol-set' },
            {
                name: 'takes the explicit option without an env var',
                option: 'event',
                env: undefined,
                expected: 'event',
            },
        ])('$name', ({ option, env, expected }) => {
            if (env === undefined) {
                delete process.env.POSTHOG_RELEASE_MODE
            } else {
                process.env.POSTHOG_RELEASE_MODE = env
            }

            const config = resolveConfig(
                {
                    personalApiKey: 'phx_personal_key',
                    projectId: 'project-id',
                    cliBinaryPath: '/tmp/posthog-cli',
                    sourcemaps: { releaseMode: option as 'symbol-set' | 'event' | undefined },
                },
                { defaultEnabled: false }
            )

            expect(config.sourcemaps.releaseMode).toBe(expected)
        })

        it('rejects an unknown release mode instead of silently binding to a release', () => {
            process.env.POSTHOG_RELEASE_MODE = 'events'

            expect(() =>
                resolveConfig({
                    personalApiKey: 'phx_personal_key',
                    projectId: 'project-id',
                    cliBinaryPath: '/tmp/posthog-cli',
                })
            ).toThrow('sourcemaps.releaseMode must be one of symbol-set, event')
        })
    })

    it('rejects a blank personalApiKey after trimming whitespace when sourcemaps are enabled', () => {
        expect(() =>
            resolveConfig({
                personalApiKey: '  \n\t ',
                projectId: 'project-id',
                cliBinaryPath: '/tmp/posthog-cli',
            })
        ).toThrow('personalApiKey is required when sourcemaps are enabled')
    })
})
