import { PostHog } from '../../posthog-core'
import { assignableWindow, document } from '../../utils/globals'
import { Autocapture } from '../../extensions/autocapture'
import { AUTOCAPTURE_DISABLED_SERVER_SIDE } from '../../constants'

describe('Autocapture wrapper', () => {
    let mockCaptureEvent: jest.Mock
    let loadCallback: ((err?: Error) => void) | null = null

    const createMockInstance = (overrides: Partial<PostHog> = {}): PostHog => {
        return {
            config: {
                autocapture: true,
                ...overrides.config,
            },
            persistence: {
                props: {
                    [AUTOCAPTURE_DISABLED_SERVER_SIDE]: false,
                },
                register: jest.fn(),
            },
            _shouldDisableFlags: () => false,
            capture: jest.fn(),
            ...overrides,
        } as unknown as PostHog
    }

    beforeEach(() => {
        mockCaptureEvent = jest.fn()
        loadCallback = null

        assignableWindow.__PosthogExtensions__ = assignableWindow.__PosthogExtensions__ || {}
        // Don't set initAutocapture initially - simulate script not loaded yet
        assignableWindow.__PosthogExtensions__.initAutocapture = undefined

        // Mock loadExternalDependency to capture the callback instead of calling it immediately
        assignableWindow.__PosthogExtensions__.loadExternalDependency = jest
            .fn()
            .mockImplementation((_ph: PostHog, _name: string, cb: (err?: Error) => void) => {
                loadCallback = cb
            })
    })

    const completeScriptLoad = () => {
        // Simulate the script loading and registering initAutocapture
        assignableWindow.__PosthogExtensions__.initAutocapture = jest.fn().mockReturnValue({
            _captureEvent: mockCaptureEvent,
            setElementSelectors: jest.fn(),
            getElementSelectors: jest.fn(),
        })
        loadCallback?.()
    }

    afterEach(() => {
        document.getElementsByTagName('html')[0].innerHTML = ''
    })

    describe('event queuing', () => {
        it('queues events before lazy load completes', () => {
            const instance = createMockInstance()
            const autocapture = new Autocapture(instance)

            // Simulate server enabling autocapture
            autocapture.onRemoteConfig({ autocapture_opt_out: false } as any)

            // Access the private queue for testing
            expect((autocapture as any)._eventQueue).toHaveLength(0)

            // Simulate click events before lazy load completes
            const button = document.createElement('button')
            document.body.appendChild(button)

            const clickEvent = new MouseEvent('click', { bubbles: true })
            ;(autocapture as any)._captureEvent(clickEvent)

            // Events should be queued
            expect((autocapture as any)._eventQueue).toHaveLength(1)
            expect((autocapture as any)._eventQueue[0].event).toBe(clickEvent)

            // Lazy-loaded implementation should not have been called yet
            expect(mockCaptureEvent).not.toHaveBeenCalled()
        })

        it('processes queued events when lazy load completes', () => {
            const instance = createMockInstance()
            const autocapture = new Autocapture(instance)

            autocapture.onRemoteConfig({ autocapture_opt_out: false } as any)

            // Queue some events
            const event1 = new MouseEvent('click', { bubbles: true })
            const event2 = new MouseEvent('click', { bubbles: true })
            ;(autocapture as any)._captureEvent(event1)
            ;(autocapture as any)._captureEvent(event2)

            expect((autocapture as any)._eventQueue).toHaveLength(2)

            // Complete the lazy load
            completeScriptLoad()

            // Queue should be empty now
            expect((autocapture as any)._eventQueue).toHaveLength(0)

            // Events should have been processed with correct timestamps
            expect(mockCaptureEvent).toHaveBeenCalledTimes(2)
            expect(mockCaptureEvent).toHaveBeenNthCalledWith(1, event1, undefined, expect.any(Date))
            expect(mockCaptureEvent).toHaveBeenNthCalledWith(2, event2, undefined, expect.any(Date))
        })

        it('limits queue size to prevent unbounded growth', () => {
            const instance = createMockInstance()
            const autocapture = new Autocapture(instance)

            autocapture.onRemoteConfig({ autocapture_opt_out: false } as any)

            // Try to queue more than MAX_QUEUED_EVENTS (1000)
            for (let i = 0; i < 1100; i++) {
                const event = new MouseEvent('click', { bubbles: true })
                ;(autocapture as any)._captureEvent(event)
            }

            // Queue should be capped at 1000
            expect((autocapture as any)._eventQueue).toHaveLength(1000)
        })

        it('passes events directly to lazy implementation after load', () => {
            const instance = createMockInstance()
            const autocapture = new Autocapture(instance)

            autocapture.onRemoteConfig({ autocapture_opt_out: false } as any)

            // Complete lazy load first
            completeScriptLoad()

            // Now capture an event
            const event = new MouseEvent('click', { bubbles: true })
            ;(autocapture as any)._captureEvent(event)

            // Should go directly to lazy implementation, not queue
            expect((autocapture as any)._eventQueue).toHaveLength(0)
            expect(mockCaptureEvent).toHaveBeenCalledWith(event, undefined)
        })

        it('does not queue events if autocapture is disabled', () => {
            const instance = createMockInstance({
                config: { autocapture: false } as any,
            })
            const autocapture = new Autocapture(instance)

            const event = new MouseEvent('click', { bubbles: true })
            ;(autocapture as any)._captureEvent(event)

            expect((autocapture as any)._eventQueue).toHaveLength(0)
            expect(mockCaptureEvent).not.toHaveBeenCalled()
        })
    })
})
