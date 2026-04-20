import { resolveConfig } from './config'

describe('resolveConfig', () => {
    it('trims whitespace-sensitive config values', () => {
        const config = resolveConfig(
            {
                personalApiKey: '  phx_personal_key\n',
                projectId: 'project-id',
                host: '  https://eu.i.posthog.com/\t ',
                cliBinaryPath: '/tmp/posthog-cli',
            },
            { defaultEnabled: false }
        )

        expect(config.personalApiKey).toBe('phx_personal_key')
        expect(config.host).toBe('https://eu.i.posthog.com/')
    })

    it('defaults a blank host after trimming whitespace', () => {
        const config = resolveConfig(
            {
                personalApiKey: 'phx_personal_key',
                projectId: 'project-id',
                host: ' \n\t ',
                cliBinaryPath: '/tmp/posthog-cli',
            },
            { defaultEnabled: false }
        )

        expect(config.host).toBe('https://us.i.posthog.com')
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
