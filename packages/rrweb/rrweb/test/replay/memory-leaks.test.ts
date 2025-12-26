import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { Replayer } from '../../src/replay'
import { EventType } from '@posthog/rrweb-types'
import type { eventWithTime } from '@posthog/rrweb-types'

describe('replay memory leak prevention', () => {
    let events: eventWithTime[]
    let dom: JSDOM
    let document: Document
    let replayer: Replayer | null = null

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
            url: 'http://localhost',
        })
        document = dom.window.document

        // Make window and all its properties global for replayer to use
        global.window = dom.window as any
        global.document = document as any
        global.Element = dom.window.Element as any
        global.HTMLElement = dom.window.HTMLElement as any
        global.HTMLIFrameElement = dom.window.HTMLIFrameElement as any
        global.Node = dom.window.Node as any

        // Create minimal valid events for replayer
        events = [
            {
                type: EventType.DomContentLoaded,
                data: {},
                timestamp: Date.now(),
            },
            {
                type: EventType.Load,
                data: {},
                timestamp: Date.now() + 100,
            },
        ]

        replayer = null
    })

    // Clean up after each test
    afterEach(() => {
        if (replayer) {
            try {
                replayer.destroy()
            } catch (e) {
                // Ignore errors during cleanup
            }
        }
    })

    describe('emitter handlers cleanup', () => {
        it('should remove all emitter handlers when replayer is destroyed', () => {
            const replayer = new Replayer(events, {
                liveMode: true,
            })

            // @ts-expect-error - accessing private property for testing
            const initialHandlerCount = replayer.emitterHandlers.length
            expect(initialHandlerCount).toBeGreaterThan(0)

            replayer.destroy()

            // @ts-expect-error - accessing private property for testing
            expect(replayer.emitterHandlers.length).toBe(0)
        })

        it('should not accumulate handlers across multiple replayer instances', () => {
            const replayer1 = new Replayer(events, { liveMode: true })
            // @ts-expect-error - accessing private property for testing
            const handlersAfterFirst = replayer1.emitterHandlers.length
            replayer1.destroy()

            const replayer2 = new Replayer(events, { liveMode: true })
            // @ts-expect-error - accessing private property for testing
            const handlersAfterSecond = replayer2.emitterHandlers.length
            expect(handlersAfterSecond).toBe(handlersAfterFirst)
            replayer2.destroy()
        })
    })

    describe('service subscriptions cleanup', () => {
        it('should unsubscribe from services when replayer is destroyed', () => {
            const replayer = new Replayer(events, { liveMode: true })

            // @ts-expect-error - accessing private property for testing
            expect(replayer.serviceSubscription).toBeDefined()
            // @ts-expect-error - accessing private property for testing
            expect(replayer.speedServiceSubscription).toBeDefined()

            replayer.destroy()

            // @ts-expect-error - accessing private property for testing
            expect(replayer.serviceSubscription).toBeUndefined()
            // @ts-expect-error - accessing private property for testing
            expect(replayer.speedServiceSubscription).toBeUndefined()
        })

        it('should call unsubscribe on both service subscriptions', () => {
            const replayer = new Replayer(events, { liveMode: true })

            // @ts-expect-error - accessing private property for testing
            const serviceUnsubscribeSpy = vi.spyOn(
                // @ts-expect-error - accessing private property for testing
                replayer.serviceSubscription,
                'unsubscribe'
            )
            // @ts-expect-error - accessing private property for testing
            const speedServiceUnsubscribeSpy = vi.spyOn(
                // @ts-expect-error - accessing private property for testing
                replayer.speedServiceSubscription,
                'unsubscribe'
            )

            replayer.destroy()

            expect(serviceUnsubscribeSpy).toHaveBeenCalledOnce()
            expect(speedServiceUnsubscribeSpy).toHaveBeenCalledOnce()
        })
    })

    describe('timeouts cleanup', () => {
        it('should clear all pending timeouts when replayer is destroyed', () => {
            const replayer = new Replayer(events, { liveMode: true })

            // @ts-expect-error - accessing private property for testing
            const initialTimeoutCount = replayer.timeouts.size

            replayer.destroy()

            // @ts-expect-error - accessing private property for testing
            expect(replayer.timeouts.size).toBe(0)
        })

        it('should clear timeout even if it was added during initialization', () => {
            const metaEvent: eventWithTime = {
                type: EventType.Meta,
                data: { width: 1024, height: 768, href: '' },
                timestamp: Date.now(),
            }
            const eventsWithMeta = [metaEvent, ...events]

            const replayer = new Replayer(eventsWithMeta, { liveMode: true })

            // addTimeout was called in constructor for meta event
            // @ts-expect-error - accessing private property for testing
            expect(replayer.timeouts.size).toBeGreaterThan(0)

            replayer.destroy()

            // @ts-expect-error - accessing private property for testing
            expect(replayer.timeouts.size).toBe(0)
        })
    })

    describe('maps cleanup', () => {
        it('should clear imageMap when replayer is destroyed', () => {
            const replayer = new Replayer(events, { liveMode: true })

            // @ts-expect-error - accessing private property for testing
            expect(replayer.imageMap).toBeDefined()

            replayer.destroy()

            // @ts-expect-error - accessing private property for testing
            expect(replayer.imageMap.size).toBe(0)
        })

        it('should clear canvasEventMap when replayer is destroyed', () => {
            const replayer = new Replayer(events, { liveMode: true })

            // @ts-expect-error - accessing private property for testing
            expect(replayer.canvasEventMap).toBeDefined()

            replayer.destroy()

            // @ts-expect-error - accessing private property for testing
            expect(replayer.canvasEventMap.size).toBe(0)
        })

        it('should not accumulate map entries across multiple instances', () => {
            const replayer1 = new Replayer(events, { liveMode: true })
            // @ts-expect-error - accessing private property for testing
            const imageMapSizeAfterFirst = replayer1.imageMap.size
            // @ts-expect-error - accessing private property for testing
            const canvasMapSizeAfterFirst = replayer1.canvasEventMap.size
            replayer1.destroy()

            const replayer2 = new Replayer(events, { liveMode: true })
            // @ts-expect-error - accessing private property for testing
            expect(replayer2.imageMap.size).toBe(imageMapSizeAfterFirst)
            // @ts-expect-error - accessing private property for testing
            expect(replayer2.canvasEventMap.size).toBe(canvasMapSizeAfterFirst)
            replayer2.destroy()
        })
    })

    describe('cache cleanup', () => {
        it('should reset cache when replayer is destroyed', () => {
            const replayer = new Replayer(events, { liveMode: true })

            // @ts-expect-error - accessing private property for testing
            const cacheBeforeDestroy = replayer.cache
            expect(cacheBeforeDestroy).toBeDefined()

            replayer.destroy()

            // @ts-expect-error - accessing private property for testing
            const cacheAfterDestroy = replayer.cache
            // After destroy, cache should be reset (new empty cache object)
            expect(cacheAfterDestroy).not.toBe(cacheBeforeDestroy)
        })
    })

    describe('comprehensive cleanup', () => {
        it('should clean up all resources in correct order', () => {
            const replayer = new Replayer(events, { liveMode: true })

            // @ts-expect-error - accessing private property for testing
            const emitterHandlersBefore = replayer.emitterHandlers.length
            // @ts-expect-error - accessing private property for testing
            const timeoutsBefore = replayer.timeouts.size

            expect(emitterHandlersBefore).toBeGreaterThan(0)

            replayer.destroy()

            // All resources should be cleaned up
            // @ts-expect-error - accessing private property for testing
            expect(replayer.emitterHandlers.length).toBe(0)
            // @ts-expect-error - accessing private property for testing
            expect(replayer.timeouts.size).toBe(0)
            // @ts-expect-error - accessing private property for testing
            expect(replayer.imageMap.size).toBe(0)
            // @ts-expect-error - accessing private property for testing
            expect(replayer.canvasEventMap.size).toBe(0)
            // @ts-expect-error - accessing private property for testing
            expect(replayer.serviceSubscription).toBeUndefined()
            // @ts-expect-error - accessing private property for testing
            expect(replayer.speedServiceSubscription).toBeUndefined()
        })

        it('should not cause errors when destroying multiple times', () => {
            const replayer = new Replayer(events, { liveMode: true })

            expect(() => {
                replayer.destroy()
                replayer.destroy()
            }).not.toThrow()
        })
    })
})
