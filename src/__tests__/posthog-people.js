import { PostHog } from '../posthog-core'
import { PostHogPeople } from '../posthog-people'

given('lib', () => Object.assign(new PostHog(), given.overrides))
given('people', () =>
    Object.assign(new PostHogPeople(given.lib), {
        _send_request: jest.fn(),
    })
)

given('overrides', () => ({
    get_config: () => ({}),
    get_property: () => 'something',
    sessionPersistence: {
        get_referrer_info: jest.fn().mockReturnValue(''),
        update_referrer_info: jest.fn(),
    },
}))

describe('posthog.people', () => {
    it('should process set correctly', () => {
        given.people.set({ set_me: 'set me' })
        expect(given.people._send_request).toHaveBeenCalledWith(
            expect.objectContaining({
                $set: expect.objectContaining({
                    set_me: 'set me',
                }),
            }),
            undefined
        )
    })

    it('should process set_once correctly', () => {
        given.people.set_once({ set_me_once: 'set once' })

        expect(given.people._send_request).toHaveBeenCalledWith({ $set_once: { set_me_once: 'set once' } }, undefined)
    })
})
