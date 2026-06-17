/// <reference lib="dom" />

import { ProductTour, ProductTourEventName } from '../../posthog-product-tours-types'
import { PostHogPersistence } from '../../posthog-persistence'
import { PostHog } from '../../posthog-core'
import { CaptureResult, PostHogConfig } from '../../types'
import { ProductTourEventReceiver } from '../../utils/product-tour-event-receiver'
import { createMockPostHog, createMockConfig } from '../helpers/posthog-instance'

// Product tours share the EventReceiver base, so the activation lifecycle behaves the same as
// surveys: armed (in-memory) until shown, never persisted (tours consume on shown). These tests
// cover that the behaviour holds for the tour receiver specifically — a fresh receiver models a reload.
describe('product-tour-event-receiver', () => {
    let config: PostHogConfig
    let instance: PostHog
    let mockAddCaptureHook: jest.Mock

    const makeTour = (overrides: Partial<ProductTour> = {}): ProductTour =>
        ({
            id: 'lifecycle-tour',
            name: 'lifecycle tour',
            conditions: { events: { values: [{ name: 'trigger_event' }] } },
            ...overrides,
        }) as unknown as ProductTour

    const tourEventPayload = (tourId: string, event: string): CaptureResult =>
        ({
            event,
            properties: { $product_tour_id: tourId },
        }) as unknown as CaptureResult

    const setup = (tour: ProductTour) => {
        config = createMockConfig({
            token: 'testtoken',
            api_host: 'https://app.posthog.com',
            persistence: 'memory',
        })
        instance = createMockPostHog({
            config,
            persistence: new PostHogPersistence(config),
            _addCaptureHook: mockAddCaptureHook,
            productTours: { getProductTours: jest.fn((callback) => callback([tour])) },
        } as unknown as Partial<PostHog>)
        const receiver = new ProductTourEventReceiver(instance)
        receiver.register([tour])
        const hook = mockAddCaptureHook.mock.calls[0][0]
        return { receiver, hook }
    }

    beforeEach(() => {
        mockAddCaptureHook = jest.fn()
    })

    afterEach(() => {
        instance.persistence?.clear()
    })

    it('does not let an armed-but-unshown tour survive a reload', () => {
        const { receiver, hook } = setup(makeTour())

        hook('trigger_event')
        expect(receiver.getTours()).toContain('lifecycle-tour')

        // Armed in memory only — a fresh receiver (a reload) does not see it.
        expect(new ProductTourEventReceiver(instance).getTours()).not.toContain('lifecycle-tour')
    })

    it('consumes a tour on shown so it does not reappear after a reload', () => {
        const { receiver, hook } = setup(makeTour())

        hook('trigger_event')
        hook(ProductTourEventName.SHOWN, tourEventPayload('lifecycle-tour', ProductTourEventName.SHOWN))

        expect(receiver.getTours()).not.toContain('lifecycle-tour')
        expect(new ProductTourEventReceiver(instance).getTours()).not.toContain('lifecycle-tour')
    })
})
