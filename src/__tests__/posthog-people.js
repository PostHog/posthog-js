import { PostHogLib } from '../posthog-core'
import { PostHogPeople } from '../posthog-people'

given('people', () => new PostHogPeople())

describe('posthog.people', () => {
    beforeEach(() => {
        const ph = new PostHogLib()
        ph.init('some token')
        given.people._init(ph)

        ph.get_config = jest.fn(() => false)
        ph.get_property = jest.fn(() => 'something')

        given.people._send_request = jest.fn()
    })

    it('should process set correctly', () => {
        given.people._posthog['persistence'] = {
            get_referrer_info: jest.fn(() => ''),
        }
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
