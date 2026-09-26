import packageInfo from '../../../package.json'
import { assignableWindow } from '../../utils/globals'
import type { PostHogConfig } from '../../types'
import { setAllPersonProfilePropertiesAsPersonPropertiesForFlags } from '../../customizations'
import { installCustomizationsQueue } from '../../customizations/deferred'

// everything the `src/customizations` barrel exports — keep in sync with customizations/index.ts
const EXPECTED_EXPORTS = [
    'setAllPersonProfilePropertiesAsPersonPropertiesForFlags',
    'sampleByDistinctId',
    'sampleBySessionId',
    'sampleByEvent',
    'printAndDropEverything',
    'posthogReduxLogger',
    'posthogKeaLogger',
    'sessionRecordingLoggerForPostHogInstance',
    'browserConsoleLogger',
]

describe('customizations entrypoints', () => {
    beforeEach(() => {
        vi.resetModules()
        delete assignableWindow.posthogCustomizations
    })

    it('exports all customizations from the module entrypoint', async () => {
        // backs the `posthog-js/customizations` subpath — the importable alternative
        // to the internal `posthog-js/lib/src/customizations` path, which is CJS-only
        // and unresolvable under native ESM / Node16 module resolution
        const entry = await import('../../entrypoints/customizations.es')

        for (const name of EXPECTED_EXPORTS) {
            expect(typeof (entry as Record<string, unknown>)[name]).toBe('function')
        }
    })

    it('publishes all customizations on window.posthogCustomizations from the script entrypoint', async () => {
        await import('../../entrypoints/customizations.full')

        for (const name of EXPECTED_EXPORTS) {
            expect(typeof assignableWindow.posthogCustomizations?.[name]).toBe('function')
        }
    })

    it('installs the queue stub from the snippet bootstrap', async () => {
        assignableWindow.posthog = { _i: [] } as any
        try {
            const { init_from_snippet } = await import('../../posthog-core')

            init_from_snippet()

            expect(
                typeof assignableWindow.posthogCustomizations?.setAllPersonProfilePropertiesAsPersonPropertiesForFlags
            ).toBe('function')
        } finally {
            assignableWindow.posthog = undefined as any
        }
    })

    it('replays calls queued before a deferred script entrypoint runs', async () => {
        // a page that loads customizations.full.js with `defer` calls the customization from
        // `loaded` before the bundle runs, so the snippet bootstrap queues the call
        installCustomizationsQueue()

        const posthog = {
            config: {},
            setPersonPropertiesForFlags: vi.fn(),
        }
        assignableWindow.posthogCustomizations.setAllPersonProfilePropertiesAsPersonPropertiesForFlags(posthog)

        expect(posthog.setPersonPropertiesForFlags).not.toHaveBeenCalled()

        await import('../../entrypoints/customizations.full')

        expect(posthog.setPersonPropertiesForFlags).toHaveBeenCalledTimes(1)
        for (const name of EXPECTED_EXPORTS) {
            expect(typeof assignableWindow.posthogCustomizations?.[name]).toBe('function')
        }
    })

    it('keeps the customizations already published by a non-deferred script entrypoint', async () => {
        await import('../../entrypoints/customizations.full')
        const published = assignableWindow.posthogCustomizations

        installCustomizationsQueue()

        expect(assignableWindow.posthogCustomizations).toBe(published)
    })

    it('initializes the shared config with the posthog-js identity', async () => {
        vi.resetModules()
        try {
            const Config = (
                await vi.importActual<typeof import('@posthog/browser-common/config')>('@posthog/browser-common/config')
            ).default
            Config.LIB_NAME = 'test-sentinel'
            Config.LIB_VERSION = '0.0.0-test'

            await vi.importActual('../../entrypoints/customizations.es')

            expect(Config).toMatchObject({
                LIB_NAME: 'web',
                LIB_VERSION: packageInfo.version,
            })
        } finally {
            vi.resetModules()
        }
    })

    it('setAllPersonProfilePropertiesAsPersonPropertiesForFlags accepts the instance passed to `loaded`', () => {
        // compile-time regression for the documented usage
        // (https://posthog.com/docs/feature-flags/property-overrides): the `loaded`
        // callback receives a `PostHogInterface`, not the concrete `PostHog` class
        const config: Partial<PostHogConfig> = {
            loaded: (posthog) => {
                setAllPersonProfilePropertiesAsPersonPropertiesForFlags(posthog)
            },
        }

        expect(config.loaded).toBeDefined()
    })
})
