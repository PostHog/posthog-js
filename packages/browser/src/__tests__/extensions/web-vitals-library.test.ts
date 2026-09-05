import { onINP } from 'web-vitals/attribution'

// The bundled web vitals observers run inside a PerformanceObserver callback, so a throw there
// escapes as an uncaught TypeError that the host application cannot catch.

type EntryListLike = { getEntries: () => any[] }

const NAVIGATION_ENTRY = {
    name: 'http://localhost/',
    type: 'navigate',
    navigationId: 1,
    responseStart: 50,
    activationStart: 0,
    domInteractive: 100,
    domContentLoadedEventStart: 120,
    domComplete: 200,
}

describe('bundled web-vitals INP observer', () => {
    const observers = new Map<string, Set<(list: EntryListLike) => void>>()
    let originals: Record<string, PropertyDescriptor | undefined> = {}

    const define = (key: string, value: unknown) => {
        originals[key] = Object.getOwnPropertyDescriptor(globalThis, key)
        Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    }

    const emit = async (type: string, entries: Record<string, unknown>[]) => {
        for (const callback of [...(observers.get(type) || [])]) {
            callback({ getEntries: () => entries.map((entry) => ({ entryType: type, ...entry })) })
        }
        await Promise.resolve()
        vi.runAllTimers()
    }

    const eventEntry = (startTime: number) => ({
        name: 'pointerdown',
        interactionId: 7,
        startTime,
        duration: 48,
        processingStart: startTime + 5,
        processingEnd: startTime + 20,
        target: null,
    })

    beforeEach(() => {
        vi.useFakeTimers()
        observers.clear()
        originals = {}

        class MockPerformanceObserver {
            static supportedEntryTypes = ['event', 'first-input', 'long-animation-frame']
            constructor(private readonly _callback: (list: EntryListLike) => void) {}
            observe({ type }: { type: string }) {
                if (!observers.has(type)) {
                    observers.set(type, new Set())
                }
                observers.get(type)!.add(this._callback)
            }
            disconnect() {}
            takeRecords() {
                return []
            }
        }
        define('PerformanceObserver', MockPerformanceObserver)

        class MockPerformanceEventTiming {}
        ;(MockPerformanceEventTiming.prototype as Record<string, unknown>).interactionId = 0
        define('PerformanceEventTiming', MockPerformanceEventTiming)

        define('performance', {
            now: () => 1000,
            getEntriesByType: (type: string) => (type === 'navigation' ? [NAVIGATION_ENTRY] : []),
            interactionCount: 1,
        })
    })

    afterEach(() => {
        vi.useRealTimers()
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) {
                Object.defineProperty(globalThis, key, descriptor)
            } else {
                delete (globalThis as Record<string, unknown>)[key]
            }
        }
    })

    it('keeps reporting after the entries of the longest interaction are emptied', async () => {
        const reported: any[] = []
        onINP((metric) => reported.push(metric), { reportAllChanges: true })

        await emit('event', [eventEntry(100)])
        expect(reported).toHaveLength(1)

        // The library hands its own interaction entries array out as `metric.entries`, so anything
        // that empties it leaves the next equally slow entry with no first entry to compare against.
        reported[0].entries.length = 0
        await emit('event', [eventEntry(180)])

        expect(reported.at(-1).name).toBe('INP')
    })
})
