import { SDK_DEBUG_EXTENSIONS_INIT_METHOD, SDK_DEBUG_EXTENSIONS_INIT_TIME_MS } from '../constants'
import { PostHog } from '../posthog-core'
import { PostHogConfig } from '../types'
import { HistoryAutocapture } from '../extensions/history-autocapture'
import { ScrollManager } from '../scroll-manager'
import { createPosthogInstance } from './helpers/posthog-instance'

describe('extension init debug properties', () => {
    let savedDefaults: PostHogConfig['__extensionClasses']
    let now = 0

    beforeEach(() => {
        savedDefaults = PostHog.__defaultExtensionClasses
        PostHog.__defaultExtensionClasses = {}
        vi.spyOn(performance, 'now').mockImplementation(() => now)
    })

    afterEach(() => {
        PostHog.__defaultExtensionClasses = savedDefaults
        vi.restoreAllMocks()
    })

    const initWith = async (
        extensionClasses: PostHogConfig['__extensionClasses'],
        initDurationMs: number
    ): Promise<Record<string, unknown>> => {
        const scrollSpy = vi.spyOn(ScrollManager.prototype, 'startMeasuringScrollPosition').mockImplementation(() => {
            now += initDurationMs
        })
        const posthog = await createPosthogInstance(undefined, {
            capture_pageview: false,
            __extensionClasses: extensionClasses,
        })
        expect(scrollSpy).toHaveBeenCalled()
        return posthog.sessionPersistence!.properties()
    }

    it('registers the init method and time when extensions took measurable time', async () => {
        const initialize = vi.spyOn(HistoryAutocapture.prototype, 'initialize').mockImplementation(() => {
            now += 12
        })

        const sessionProps = await initWith({ historyAutocapture: HistoryAutocapture }, 0)

        expect(initialize).toHaveBeenCalled()
        expect(sessionProps[SDK_DEBUG_EXTENSIONS_INIT_METHOD]).toBe('synchronous')
        expect(sessionProps[SDK_DEBUG_EXTENSIONS_INIT_TIME_MS]).toBe(12)
    })

    it('does not register them when no extensions are bundled, even if init takes time', async () => {
        const sessionProps = await initWith({}, 12)

        expect(sessionProps).not.toHaveProperty(SDK_DEBUG_EXTENSIONS_INIT_METHOD)
        expect(sessionProps).not.toHaveProperty(SDK_DEBUG_EXTENSIONS_INIT_TIME_MS)
    })

    it('does not register them when extension init time rounds to zero', async () => {
        vi.spyOn(HistoryAutocapture.prototype, 'initialize').mockImplementation(() => {
            now += 0.4
        })

        const sessionProps = await initWith({ historyAutocapture: HistoryAutocapture }, 0)

        expect(sessionProps).not.toHaveProperty(SDK_DEBUG_EXTENSIONS_INIT_METHOD)
        expect(sessionProps).not.toHaveProperty(SDK_DEBUG_EXTENSIONS_INIT_TIME_MS)
    })
})
