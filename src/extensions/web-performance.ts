import { PostHog } from '../posthog-core'

const BASE_ENDPOINT = '/p/'

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
        const properties = {
            ...event,
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
