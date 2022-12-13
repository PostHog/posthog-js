import { PostHog } from '../posthog-core'

const BASE_ENDPOINT = '/p/'

const PERFORMANCE_EVENTS_MAPPING: { [key: string]: number } = {
    // BASE_PERFORMANCE_EVENT_COLUMNS
    entryType: 0,
    timeOrigin: 1,
    name: 2,

    // RESOURCE_EVENT_COLUMNS
    startTime: 3,
    redirectStart: 4,
    redirectEnd: 5,
    workerStart: 6,
    fetchStart: 7,
    domainLookupStart: 8,
    domainLookupEnd: 9,
    connectStart: 10,
    secureConnectionStart: 11,
    connectEnd: 12,
    requestStart: 13,
    responseStart: 14,
    responseEnd: 15,
    decodedBodySize: 16,
    encodedBodySize: 17,
    initiatorType: 18,
    nextHopProtocol: 19,
    renderBlockingStatus: 20,
    responseStatus: 21,
    transferSize: 22,

    // LARGEST_CONTENTFUL_PAINT_EVENT_COLUMNS
    element: 23,
    renderTime: 24,
    loadTime: 25,
    size: 26,
    id: 27,
    url: 28,

    // NAVIGATION_EVENT_COLUMNS
    domComplete: 29,
    domContentLoadedEvent: 30,
    domInteractive: 31,
    loadEventEnd: 32,
    loadEventStart: 33,
    redirectCount: 34,
    navigationType: 35,
    unloadEventEnd: 36,
    unloadEventStart: 37,

    // NOTE: CURRENTLY UNSUPPORTED
    // EVENT_TIMING_EVENT_COLUMNS
    // processingStart: null,
    // processingEnd: null,

    // MARK_AND_MEASURE_EVENT_COLUMNS
    // detail: null,
}

const ENTRY_TYPES_TO_OBSERVE = [
    // 'event', // This is too noisy as it covers all browser events
    'first-input',
    // 'mark', // Mark is used too liberally. We would need to filter for specific marks
    // 'measure', // Measure is used too liberally. We would need to filter for specific measures
    'navigation',
    'paint',
    'resource',
]

const POSTHOG_PATHS_TO_IGNORE = [BASE_ENDPOINT, '/s/', '/e/']

export class WebPerformanceObserver {
    instance: PostHog
    endpoint: string
    receivedDecide: boolean
    observer: PerformanceObserver | undefined

    constructor(instance: PostHog) {
        this.instance = instance
        this.endpoint = BASE_ENDPOINT
        this.receivedDecide = false
    }

    startObservingIfEnabled() {
        if (this.isEnabled()) {
            this.startObserving()
        } else {
            this.stopObserving()
        }
    }

    startObserving() {
        if (this.observer) {
            return
        }
        try {
            this.observer = new PerformanceObserver((list) => {
                list.getEntries().forEach((entry) => {
                    this._capturePerformanceEvent(entry)
                })
            })

            const entryTypes = PerformanceObserver.supportedEntryTypes.filter((x) => ENTRY_TYPES_TO_OBSERVE.includes(x))
            this.observer.observe({ entryTypes })
        } catch (e) {
            console.error('PostHog failed to start performance observer', e)
            this.stopObserving()
        }
    }

    stopObserving() {
        if (this.observer) {
            this.observer.disconnect()
            this.observer = undefined
        }
    }

    isObserving() {
        return !!this.observer
    }

    isEnabled() {
        return !!this.instance.get_config('_capture_performance')
    }

    _capturePerformanceEvent(event: PerformanceEntry) {
        // NOTE: We don't want to capture our own request events.

        if (event.name.startsWith(this.instance.get_config('api_host'))) {
            const path = event.name.replace(this.instance.get_config('api_host'), '')

            if (POSTHOG_PATHS_TO_IGNORE.find((x) => path.startsWith(x))) {
                return
            }
        }

        const eventJson = event.toJSON()
        type AllowedKeys = number | '$origin_timestamp'
        // kudos to sentry javascript sdk for excellent background on why to use Date.now() here
        // https://github.com/getsentry/sentry-javascript/blob/e856e40b6e71a73252e788cd42b5260f81c9c88e/packages/utils/src/time.ts#L70
        const properties: { [key in AllowedKeys]: any } = { $origin_timestamp: new Date(Date.now() - performance.now()).toISOString() }
        properties[PERFORMANCE_EVENTS_MAPPING['timeOrigin']] = Date.now() - performance.now()
        for (const key in PERFORMANCE_EVENTS_MAPPING) {
            if (eventJson[key] !== undefined) {
                properties[PERFORMANCE_EVENTS_MAPPING[key]] = eventJson[key]
            }
        }

        // :TRICKY: Make sure we batch these requests, use a custom endpoint and don't truncate the strings.
        this.instance.capture('$performance_event', properties, {
            transport: 'XHR',
            method: 'POST',
            endpoint: this.endpoint,
            _noTruncate: true,
            _batchKey: 'performanceEvent',
        })
    }
}
