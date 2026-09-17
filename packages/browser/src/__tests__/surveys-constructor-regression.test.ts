import { SurveyEventReceiver } from '../utils/survey-event-receiver'
import { ProductTourEventReceiver } from '../utils/product-tour-event-receiver'
import type { PostHog } from '../posthog-core'
import {
    SURVEYS_ACTIVATED,
    SURVEYS_ACTIVATED_SESSION,
    PRODUCT_TOURS_ACTIVATED,
    PRODUCT_TOURS_ACTIVATED_SESSION,
} from '../constants'

it.each([
    [SurveyEventReceiver, SURVEYS_ACTIVATED, SURVEYS_ACTIVATED_SESSION],
    [ProductTourEventReceiver, PRODUCT_TOURS_ACTIVATED, PRODUCT_TOURS_ACTIVATED_SESSION],
] as const)(
    'clears stale activations during synchronous session subscription (%s)',
    (Receiver, activatedKey, sessionKey) => {
        const props: Record<string, unknown> = { [activatedKey]: ['item'], [sessionKey]: 'old' }
        const register = vi.fn((values) => Object.assign(props, values))
        const unregister = vi.fn((key) => delete props[key])
        const instance = {
            persistence: { props, register, unregister },
            onSessionId: (callback: (sessionId: string) => void) => {
                callback('new')
                return () => {}
            },
        } as unknown as PostHog
        const receiver = new Receiver(instance)
        expect(props[activatedKey]).toEqual([])
        expect(props[sessionKey]).toBeUndefined()
        receiver.dispose()
    }
)
