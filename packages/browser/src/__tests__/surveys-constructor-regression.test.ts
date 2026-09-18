import { BrowserClientAdapter } from '../extensions/browser-client'
import { SurveyEventReceiver } from '@posthog/browser-common/survey-event-receiver'
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
            persistence: { props, register, unregister, get_property: (key: string) => props[key] },
            onSessionId: (callback: (sessionId: string) => void) => {
                callback('new')
                return () => {}
            },
        } as unknown as PostHog
        const receiver =
            Receiver === SurveyEventReceiver
                ? new SurveyEventReceiver(new BrowserClientAdapter(instance), instance)
                : new ProductTourEventReceiver(instance)
        expect(props[activatedKey]).toEqual([])
        expect(props[sessionKey]).toBeUndefined()
        receiver.dispose()
    }
)
