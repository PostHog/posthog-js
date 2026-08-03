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

    it.each([
        { name: 'defaults to false', option: undefined, env: undefined, expected: false },
        { name: 'reads the option', option: true, env: undefined, expected: true },
        { name: 'falls back to the env var', option: undefined, env: '1', expected: true },
        { name: 'treats boolish-false env values as false', option: undefined, env: 'off', expected: false },
        { name: 'lets an explicit option override the env var', option: false, env: 'true', expected: false },
    ])('resolves sourcemaps.noReleaseBind: $name', ({ option, env, expected }) => {
        const previous = process.env.POSTHOG_NO_RELEASE_BIND
        if (env === undefined) {
            delete process.env.POSTHOG_NO_RELEASE_BIND
        } else {
            process.env.POSTHOG_NO_RELEASE_BIND = env
        }
        try {
            const config = resolveConfig(
                {
                    personalApiKey: 'phx_personal_key',
                    projectId: 'project-id',
                    cliBinaryPath: '/tmp/posthog-cli',
                    sourcemaps: { noReleaseBind: option },
                },
                { defaultEnabled: false }
            )
            expect(config.sourcemaps.noReleaseBind).toBe(expected)
        } finally {
            if (previous === undefined) {
                delete process.env.POSTHOG_NO_RELEASE_BIND
            } else {
                process.env.POSTHOG_NO_RELEASE_BIND = previous
            }
        }
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
