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
