import { uuidv7 } from '@posthog/browser-common/utils/uuidv7'

import { SDK_DEBUG_EXTENSIONS_INIT_METHOD, SDK_DEBUG_EXTENSIONS_INIT_TIME_MS } from '../constants'
import { PostHog } from '../posthog-core'
import { createPosthogInstance } from './helpers/posthog-instance'

describe('extension init debug properties', () => {
    let instance: PostHog

    beforeEach(async () => {
        instance = await createPosthogInstance(uuidv7())
        instance.unregister_for_session(SDK_DEBUG_EXTENSIONS_INIT_METHOD)
        instance.unregister_for_session(SDK_DEBUG_EXTENSIONS_INIT_TIME_MS)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    const processQueue = (hasExtensions: boolean, endTime: number) => {
        vi.spyOn(performance, 'now').mockReturnValue(endTime)
        instance['_processInitTaskQueue']([vi.fn()], 0, hasExtensions)
    }

    it('registers the init method and time when extensions took measurable time', () => {
        processQueue(true, 12)

        const sessionProps = instance.sessionPersistence!.properties()
        expect(sessionProps[SDK_DEBUG_EXTENSIONS_INIT_METHOD]).toBe('synchronous')
        expect(sessionProps[SDK_DEBUG_EXTENSIONS_INIT_TIME_MS]).toBe(12)
    })

    it.each([
        ['no extensions were loaded', false, 12],
        ['extension init time rounds to zero', true, 0.4],
    ])('does not register them when %s', (_case, hasExtensions, endTime) => {
        processQueue(hasExtensions, endTime)

        const sessionProps = instance.sessionPersistence!.properties()
        expect(sessionProps).not.toHaveProperty(SDK_DEBUG_EXTENSIONS_INIT_METHOD)
        expect(sessionProps).not.toHaveProperty(SDK_DEBUG_EXTENSIONS_INIT_TIME_MS)
    })
})
