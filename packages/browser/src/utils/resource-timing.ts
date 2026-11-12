import { window } from '@posthog/browser-common/utils/globals'
import { convertToURL } from '@posthog/browser-common/utils/request-utils'
import { isFunction } from '@posthog/core'

import { now } from './now'

// Chrome delivers a request's entry in a task after the response body resolves. Under a busy main thread
// that task can run late, so the watch waits this long after `take` before it gives up.
export const RESOURCE_ENTRY_WAIT_MS = 5000

export interface ResourceTimingWatch {
    /**
     * Calls `onEntry` once with the entry of this request, then disconnects. Disconnects without calling it
     * when no entry arrives in `RESOURCE_ENTRY_WAIT_MS`. `endedAt` is when the request finished on the
     * `now()` clock, and entries that start after it are ignored.
     */
    take(endedAt: number, onEntry: (entry: PerformanceResourceTiming) => void): void
    stop(): void
}

interface LiveWatch {
    name: string
    // Entries that start at or after this time belong to a later request to the same URL.
    before: number
    // True until `take` runs, which happens when the request ends.
    inFlight: boolean
}

// Requests to the same URL can overlap, for example a flags reload and a remote config payload request.
// Each transport starts its request right after it creates the watch, so the request's entry starts
// after its own watch and before the next watch for that URL.
const liveWatches: LiveWatch[] = []

/**
 * Watches for the Resource Timing entry of a request to `url` that is about to start.
 *
 * It uses an observer rather than `performance.getEntriesByName` because a page that fills the resource
 * timing buffer (250 entries by default) stops adding entries to it, while observers still receive them.
 * Returns undefined when the browser cannot observe resource entries.
 */
export const watchResourceTiming = (url: string): ResourceTimingWatch | undefined => {
    const Observer = window?.PerformanceObserver
    const name = convertToURL(url)?.href
    if (!Observer || !name) {
        return undefined
    }

    const startedAt = now()
    const live: LiveWatch = { name, before: Infinity, inFlight: true }
    let found: PerformanceResourceTiming | undefined
    let endedAt = Infinity
    let onEntry: ((entry: PerformanceResourceTiming) => void) | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const stop = () => {
        if (stopped) {
            return
        }
        stopped = true
        clearTimeout(timer)
        observer.disconnect()
        liveWatches.splice(liveWatches.indexOf(live), 1)
    }

    // A request to the URL that is still in flight can have an entry that starts at exactly `startedAt`.
    // Such an entry could belong to either request, so this watch refuses it. A request that has ended
    // started at least one round trip before `startedAt`, so its entry cannot tie.
    let followsInFlightWatch = false
    const collect = (entries: PerformanceEntryList) => {
        for (const entry of entries) {
            const startTime = entry.startTime
            if (
                entry.name === name &&
                (followsInFlightWatch ? startTime > startedAt : startTime >= startedAt) &&
                startTime < live.before &&
                (!found || startTime < found.startTime)
            ) {
                found = entry as PerformanceResourceTiming
            }
        }
        if (found && onEntry && found.startTime <= endedAt) {
            const callback = onEntry
            stop()
            callback(found)
        }
    }

    // The transport calls this just before it sends, so nothing here may throw.
    let observer: PerformanceObserver
    try {
        observer = new Observer((list) => collect(list.getEntriesByName(name, 'resource')))
        observer.observe({ entryTypes: ['resource'] })
    } catch {
        return undefined
    }
    for (const other of liveWatches) {
        if (other.name === name) {
            other.before = Math.min(other.before, startedAt)
            followsInFlightWatch = followsInFlightWatch || other.inFlight
        }
    }
    liveWatches.push(live)

    return {
        take(requestEndedAt, callback) {
            if (stopped) {
                return
            }
            endedAt = requestEndedAt
            live.inFlight = false
            onEntry = callback
            timer = setTimeout(stop, RESOURCE_ENTRY_WAIT_MS)
            if (isFunction(observer.takeRecords)) {
                collect(observer.takeRecords())
            }
        },
        stop,
    }
}
