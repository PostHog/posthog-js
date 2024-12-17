import { defaultPostHog } from './helpers/posthog-instance'
import type { PostHogConfig } from '../types'
import { uuidv7 } from '../uuidv7'

describe('cookieless', () => {
    const eventName = 'custom_event'
    const eventProperties = {
        event: 'prop',
    }
    const identifiedDistinctId = 'user-1'
    const setup = (config: Partial<PostHogConfig> = {}, token: string = uuidv7()) => {
        const beforeSendMock = jest.fn().mockImplementation((e) => e)
        const posthog = defaultPostHog().init(token, { ...config, before_send: beforeSendMock }, token)!
        posthog.debug()
        return { posthog, beforeSendMock }
    }

    it('should send events with the sentinel distinct id', () => {
        const { posthog, beforeSendMock } = setup({
            persistence: 'memory',
            __preview_experimental_cookieless_mode: true,
        })

        posthog.capture(eventName, eventProperties)
        expect(beforeSendMock).toBeCalledTimes(1)
        let event = beforeSendMock.mock.calls[0][0]
        expect(event.properties.distinct_id).toBe('$posthog_cklsh')
        expect(event.properties.$anon_distinct_id).toBe(undefined)
        expect(event.properties.$device_id).toBe(null)
        expect(event.properties.$session_id).toBe(undefined)
        expect(event.properties.$window_id).toBe(undefined)
        expect(event.properties.$cklsh_mode).toEqual(true)
        expect(document.cookie).toBe('')

        // simulate user giving cookie consent
        posthog.set_config({ persistence: 'localStorage+cookie' })

        // send an event after consent
        posthog.capture(eventName, eventProperties)
        expect(beforeSendMock).toBeCalledTimes(2)
        event = beforeSendMock.mock.calls[1][0]
        expect(event.properties.distinct_id).toBe('$posthog_cklsh')
        expect(event.properties.$anon_distinct_id).toBe(undefined)
        expect(event.properties.$device_id).toBe(null)
        expect(event.properties.$session_id).toBe(undefined)
        expect(event.properties.$window_id).toBe(undefined)
        expect(event.properties.$cklsh_mode).toEqual(true)
        expect(document.cookie).not.toBe('')

        // a user identifying
        posthog.identify(identifiedDistinctId)
        expect(beforeSendMock).toBeCalledTimes(3)
        event = beforeSendMock.mock.calls[2][0]
        expect(event.properties.distinct_id).toBe(identifiedDistinctId)
        expect(event.properties.$anon_distinct_id).toBe('$posthog_cklsh')
        expect(event.properties.$device_id).toBe(null)
        expect(event.properties.$session_id).toBe(undefined)
        expect(event.properties.$window_id).toBe(undefined)
        expect(event.properties.$cklsh_mode).toEqual(true)

        // an event after identifying
        posthog.capture(eventName, eventProperties)
        expect(beforeSendMock).toBeCalledTimes(4)
        event = beforeSendMock.mock.calls[3][0]
        expect(event.properties.distinct_id).toBe(identifiedDistinctId)
        expect(event.properties.$anon_distinct_id).toBe(undefined)
        expect(event.properties.$device_id).toBe(null)
        expect(event.properties.$session_id).toBe(undefined)
        expect(event.properties.$window_id).toBe(undefined)
        expect(event.properties.$cklsh_mode).toEqual(true)

        // reset
        posthog.reset()
        posthog.set_config({ persistence: 'memory' })

        // an event after reset
        posthog.capture(eventName, eventProperties)
        expect(beforeSendMock).toBeCalledTimes(5)
        event = beforeSendMock.mock.calls[4][0]
        expect(event.properties.distinct_id).toBe('$posthog_cklsh')
        expect(event.properties.$anon_distinct_id).toBe(undefined)
        expect(event.properties.$device_id).toBe(null)
        expect(event.properties.$session_id).toBe(undefined)
        expect(event.properties.$window_id).toBe(undefined)
        expect(event.properties.$cklsh_mode).toEqual(true)
        expect(document.cookie).toBe('')
    })
})
