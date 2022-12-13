import { PostHog } from '../posthog-core'

const BASE_ENDPOINT = '/p/'

const PERFORMANCE_EVENTS_MAPPING: { [key: string]: number } = {
    // BASE_PERFORMANCE_EVENT_COLUMNS
    entry_type: 0,
    time_origin: 1,
    name: 2,

    // RESOURCE_EVENT_COLUMNS
    start_time: 3,
    redirect_start: 4,
    redirect_end: 5,
    worker_start: 6,
    fetch_start: 7,
    domain_lookup_start: 8,
    domain_lookup_end: 9,
    connect_start: 10,
    secure_connection_start: 11,
    connect_end: 12,
    request_start: 13,
    response_start: 14,
    response_end: 15,
    decoded_body_size: 16,
    encoded_body_size: 17,
    initiator_type: 18,
    next_hop_protocol: 19,
    render_blocking_status: 20,
    response_status: 21,
    transfer_size: 22,

    // LARGEST_CONTENTFUL_PAINT_EVENT_COLUMNS
    largest_contentful_paint_element: 23,
    largest_contentful_paint_render_time: 24,
    largest_contentful_paint_load_time: 25,
    largest_contentful_paint_size: 26,
    largest_contentful_paint_id: 27,
    largest_contentful_paint_url: 28,

    // EVENT_TIMING_EVENT_COLUMNS
    event_timing_processing_start: 29,
    event_timing_processing_end: 30,

    // MARK_AND_MEASURE_EVENT_COLUMNS
    detail: 31,

    // NAVIGATION_EVENT_COLUMNS
    dom_complete: 32,
    dom_content_loaded_event: 33,
    dom_interactive: 34,
    load_event_end: 35,
    load_event_start: 36,
    redirect_count: 37,
    navigation_type: 38,
    unload_event_end: 39,
    unload_event_start: 40,

    // Other
    current_url: 41,
}

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
        this.observer = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
                this._capturePerformanceEvent(entry)
            })
        })

        this.observer.observe({ buffered: true, entryTypes: [...PerformanceObserver.supportedEntryTypes] })
    }

    stopObserving() {
        if (this.observer) {
            this.observer.disconnect()
            this.observer = undefined
        }
    }

    isEnabled() {
        return !!this.instance.get_config('_capture_performance')
    }

    _capturePerformanceEvent(event: PerformanceEntry) {
        const eventJson = event.toJSON()
        const properties: { [key: number]: any } = {}
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
