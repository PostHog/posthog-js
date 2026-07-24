import packageInfo from '../../../package.json'
import { assignableWindow } from '../../utils/globals'
import type { PostHogConfig } from '../../types'
import { setAllPersonProfilePropertiesAsPersonPropertiesForFlags } from '../../customizations'

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
        jest.resetModules()
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

    it('initializes the shared config with the posthog-js identity', () => {
        jest.isolateModules(() => {
            const Config = jest.requireActual<typeof import('@posthog/browser-common/config')>(
                '@posthog/browser-common/config'
            ).default
            Config.LIB_NAME = 'test-sentinel'
            Config.LIB_VERSION = '0.0.0-test'
            Config.JS_SDK_VERSION = '0.0.0-test'

            jest.requireActual('../../entrypoints/customizations.es')

            expect(Config).toMatchObject({
                LIB_NAME: 'web',
                LIB_VERSION: packageInfo.version,
                JS_SDK_VERSION: packageInfo.version,
            })
        })
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
