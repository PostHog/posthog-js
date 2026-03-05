import { resolveConfig, PluginConfig } from '../config'

// Mock resolveBinaryPath to avoid filesystem access
jest.mock('@posthog/core/process', () => ({
    resolveBinaryPath: () => '/mocked/posthog-cli',
}))

const originalEnv = process.env

beforeEach(() => {
    process.env = { ...originalEnv }
    // Clear relevant env vars
    delete process.env.POSTHOG_PERSONAL_API_KEY
    delete process.env.POSTHOG_CLI_API_KEY
    delete process.env.POSTHOG_PROJECT_ID
    delete process.env.POSTHOG_CLI_PROJECT_ID
    delete process.env.POSTHOG_HOST
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST
})

afterEach(() => {
    process.env = originalEnv
})

describe('resolveConfig', () => {
    const validConfig: PluginConfig = {
        personalApiKey: 'phx_my-api-key',
        projectId: 'project-123',
    }

    it('resolves config with explicit options', () => {
        const resolved = resolveConfig(validConfig)
        expect(resolved.personalApiKey).toBe('phx_my-api-key')
        expect(resolved.projectId).toBe('project-123')
        expect(resolved.host).toBe('https://us.i.posthog.com')
    })

    it('throws when projectId is missing and no env var fallback', () => {
        expect(() => resolveConfig({ personalApiKey: 'phx_key' })).toThrow(
            /projectId is required/
        )
        expect(() => resolveConfig({ personalApiKey: 'phx_key' })).toThrow(
            /POSTHOG_PROJECT_ID/
        )
    })

    describe('environment variable fallbacks', () => {
        it('reads personalApiKey from POSTHOG_PERSONAL_API_KEY', () => {
            process.env.POSTHOG_PERSONAL_API_KEY = 'phx_env-key'
            const resolved = resolveConfig({
                personalApiKey: '',
                projectId: 'project-123',
            })
            expect(resolved.personalApiKey).toBe('phx_env-key')
        })

        it('reads personalApiKey from POSTHOG_CLI_API_KEY', () => {
            process.env.POSTHOG_CLI_API_KEY = 'phx_cli-key'
            const resolved = resolveConfig({
                personalApiKey: '',
                projectId: 'project-123',
            })
            expect(resolved.personalApiKey).toBe('phx_cli-key')
        })

        it('prefers explicit personalApiKey over env var', () => {
            process.env.POSTHOG_PERSONAL_API_KEY = 'phx_env-key'
            const resolved = resolveConfig({
                personalApiKey: 'phx_explicit-key',
                projectId: 'project-123',
            })
            expect(resolved.personalApiKey).toBe('phx_explicit-key')
        })

        it('reads projectId from POSTHOG_PROJECT_ID', () => {
            process.env.POSTHOG_PROJECT_ID = 'env-project-456'
            const resolved = resolveConfig({
                personalApiKey: 'phx_key',
            })
            expect(resolved.projectId).toBe('env-project-456')
        })

        it('reads projectId from POSTHOG_CLI_PROJECT_ID', () => {
            process.env.POSTHOG_CLI_PROJECT_ID = 'cli-project-789'
            const resolved = resolveConfig({
                personalApiKey: 'phx_key',
            })
            expect(resolved.projectId).toBe('cli-project-789')
        })

        it('prefers explicit projectId over env var', () => {
            process.env.POSTHOG_PROJECT_ID = 'env-project'
            const resolved = resolveConfig({
                personalApiKey: 'phx_key',
                projectId: 'explicit-project',
            })
            expect(resolved.projectId).toBe('explicit-project')
        })

        it('prefers POSTHOG_PERSONAL_API_KEY over POSTHOG_CLI_API_KEY', () => {
            process.env.POSTHOG_PERSONAL_API_KEY = 'phx_personal'
            process.env.POSTHOG_CLI_API_KEY = 'phx_cli'
            const resolved = resolveConfig({
                personalApiKey: '',
                projectId: 'project-123',
            })
            expect(resolved.personalApiKey).toBe('phx_personal')
        })

        it('prefers POSTHOG_PROJECT_ID over POSTHOG_CLI_PROJECT_ID', () => {
            process.env.POSTHOG_PROJECT_ID = 'project-personal'
            process.env.POSTHOG_CLI_PROJECT_ID = 'project-cli'
            const resolved = resolveConfig({
                personalApiKey: 'phx_key',
            })
            expect(resolved.projectId).toBe('project-personal')
        })

        it('reads host from POSTHOG_HOST', () => {
            process.env.POSTHOG_HOST = 'https://eu.i.posthog.com'
            const resolved = resolveConfig({
                personalApiKey: 'phx_key',
                projectId: 'project-123',
            })
            expect(resolved.host).toBe('https://eu.i.posthog.com')
        })

        it('reads host from NEXT_PUBLIC_POSTHOG_HOST', () => {
            process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com'
            const resolved = resolveConfig({
                personalApiKey: 'phx_key',
                projectId: 'project-123',
            })
            expect(resolved.host).toBe('https://eu.i.posthog.com')
        })

        it('prefers explicit host over env var', () => {
            process.env.POSTHOG_HOST = 'https://env-host.com'
            const resolved = resolveConfig({
                personalApiKey: 'phx_key',
                projectId: 'project-123',
                host: 'https://explicit-host.com',
            })
            expect(resolved.host).toBe('https://explicit-host.com')
        })

        it('resolves all values from environment variables only', () => {
            process.env.POSTHOG_PERSONAL_API_KEY = 'phx_env-key'
            process.env.POSTHOG_PROJECT_ID = 'env-project-123'
            process.env.POSTHOG_HOST = 'https://eu.i.posthog.com'
            const resolved = resolveConfig({
                personalApiKey: '',
            })
            expect(resolved.personalApiKey).toBe('phx_env-key')
            expect(resolved.projectId).toBe('env-project-123')
            expect(resolved.host).toBe('https://eu.i.posthog.com')
        })
    })

    describe('deprecated envId fallback', () => {
        it('falls back to envId when projectId is not set', () => {
            const resolved = resolveConfig({
                personalApiKey: 'phx_key',
                envId: 'env-id-123',
            })
            expect(resolved.projectId).toBe('env-id-123')
        })

        it('prefers projectId over envId', () => {
            const resolved = resolveConfig({
                personalApiKey: 'phx_key',
                projectId: 'project-123',
                envId: 'env-id-123',
            })
            expect(resolved.projectId).toBe('project-123')
        })
    })

    describe('sourcemaps defaults', () => {
        it('defaults deleteAfterUpload to true', () => {
            const resolved = resolveConfig(validConfig)
            expect(resolved.sourcemaps.deleteAfterUpload).toBe(true)
        })

        it('defaults logLevel to info', () => {
            const resolved = resolveConfig(validConfig)
            expect(resolved.logLevel).toBe('info')
        })
    })
})
