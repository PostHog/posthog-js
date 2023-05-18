import { isLocalhost, logger } from '../utils'
import { PostHog } from '../posthog-core'
import { DecideResponse, NetworkRequest } from '../types'

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

    // Added after v1
    duration: 39,
    timestamp: 40,

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

const PERFORMANCE_INGESTION_ENDPOINT = '/e/'
// Don't monitor posthog paths because then events cause performance events which are events and the snake eats its tail 😱
const POSTHOG_PATHS_TO_IGNORE = ['/s/', PERFORMANCE_INGESTION_ENDPOINT]

export class WebPerformanceObserver {
    instance: PostHog
    remoteEnabled: boolean | undefined
    observer: PerformanceObserver | undefined

    // Util to help developers working on this feature manually override
    _forceAllowLocalhost = false

    constructor(instance: PostHog) {
        this.instance = instance
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

        if (isLocalhost() && !this._forceAllowLocalhost) {
            logger.log('PostHog Peformance observer not started because we are on localhost.')
            return
        }

        try {
            this.observer = new PerformanceObserver((list) => {
                list.getEntries().forEach((entry) => {
                    this._capturePerformanceEvent(entry)
                })
            })

            const entryTypes = PerformanceObserver.supportedEntryTypes.filter((x) => ENTRY_TYPES_TO_OBSERVE.includes(x))

            entryTypes.forEach((entryType) => {
                this.observer?.observe({ type: entryType, buffered: true })
            })
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
        return this.instance.get_config('capture_performance') ?? this.remoteEnabled ?? false
    }

    afterDecideResponse(response: DecideResponse) {
        this.remoteEnabled = response.capturePerformance || false
        if (this.isEnabled()) {
            this.startObserving()
        }
    }

    _capturePerformanceEvent(event: PerformanceEntry) {
        // NOTE: We don't want to capture our own request events.

        if (event.name.startsWith(this.instance.get_config('api_host'))) {
            const path = event.name.replace(this.instance.get_config('api_host'), '')

            if (POSTHOG_PATHS_TO_IGNORE.find((x) => path.startsWith(x))) {
                return
            }
        }

        // NOTE: This is minimal atm but will include more options when we move to the
        // built in rrweb network recorder
        let networkRequest: NetworkRequest | null | undefined = {
            url: event.name,
        }

        const userSessionRecordingOptions = this.instance.get_config('session_recording')

        if (userSessionRecordingOptions.maskNetworkRequestFn) {
            networkRequest = userSessionRecordingOptions.maskNetworkRequestFn(networkRequest)
        }

        if (!networkRequest) {
            return
        }

        const eventJson = event.toJSON()
        eventJson.name = networkRequest.url
        const properties: { [key: number]: any } = {}
        // kudos to sentry javascript sdk for excellent background on why to use Date.now() here
        // https://github.com/getsentry/sentry-javascript/blob/e856e40b6e71a73252e788cd42b5260f81c9c88e/packages/utils/src/time.ts#L70
        const timeOrigin = Math.floor(Date.now() - performance.now())
        properties[PERFORMANCE_EVENTS_MAPPING['timeOrigin']] = timeOrigin
        // clickhouse can't ingest timestamps that are floats
        // (in this case representing fractions of a millisecond we don't care about anyway)
        properties[PERFORMANCE_EVENTS_MAPPING['timestamp']] = Math.floor(timeOrigin + event.startTime)
        for (const key in PERFORMANCE_EVENTS_MAPPING) {
            if (eventJson[key] !== undefined) {
                properties[PERFORMANCE_EVENTS_MAPPING[key]] = eventJson[key]
            }
        }

        this.capturePerformanceEvent(properties)

        if (exposesServerTiming(event)) {
            for (const timing of event.serverTiming || []) {
                this.capturePerformanceEvent({
                    [PERFORMANCE_EVENTS_MAPPING['timeOrigin']]: timeOrigin,
                    [PERFORMANCE_EVENTS_MAPPING['timestamp']]: Math.floor(timeOrigin + event.startTime),
                    [PERFORMANCE_EVENTS_MAPPING['name']]: timing.name,
                    [PERFORMANCE_EVENTS_MAPPING['duration']]: timing.duration,
                    // the spec has a closed list of possible types
                    // https://developer.mozilla.org/en-US/docs/Web/API/PerformanceEntry/entryType
                    // but, we need to know this was a server timing so that we know to
                    // match it to the appropriate navigation or resource timing
                    // that matching will have to be on timestamp and $current_url
                    [PERFORMANCE_EVENTS_MAPPING['entryType']]: 'serverTiming',
                })
            }
        }
    }

    /**
     * :TRICKY: Make sure we batch these requests, and don't truncate the strings.
     */
    private capturePerformanceEvent(properties: { [key: number]: any }) {
        const timestamp = properties[PERFORMANCE_EVENTS_MAPPING['timestamp']]

        this.instance.sessionRecording?.onRRwebEmit({
            type: 6, // EventType.Plugin,
            data: {
                plugin: 'posthog/network@1',
                payload: properties,
            },
            timestamp,
        })

        // this.instance.capture('$performance_event', properties, {
        //     transport: 'XHR',
        //     method: 'POST',
        //     endpoint: PERFORMANCE_INGESTION_ENDPOINT,
        //     _noTruncate: true,
        //     _batchKey: 'performanceEvent',
        // })
    }
}

/**
 *  Check if this PerformanceEntry is either a PerformanceResourceTiming or a PerformanceNavigationTiming
 *  NB PerformanceNavigationTiming extends PerformanceResourceTiming
 *  Here we don't care which interface it implements as both expose `serverTimings`
 */
const exposesServerTiming = (event: PerformanceEntry): event is PerformanceResourceTiming =>
    event.entryType === 'navigation' || event.entryType === 'resource'
