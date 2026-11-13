// Browsers give an observer its entries in a later task. `queue` models an entry that the browser
// recorded but has not delivered yet, which only `takeRecords()` returns. `deliver` runs the callback.
export class FakePerformanceObserver {
    static instances: FakePerformanceObserver[] = []

    observed: PerformanceObserverInit | undefined
    disconnected = false
    private _pending: PerformanceEntry[] = []

    constructor(private readonly _callback: PerformanceObserverCallback) {
        FakePerformanceObserver.instances.push(this)
    }

    static get latest(): FakePerformanceObserver {
        return FakePerformanceObserver.instances[FakePerformanceObserver.instances.length - 1]
    }

    static reset(): void {
        FakePerformanceObserver.instances = []
    }

    observe(options: PerformanceObserverInit): void {
        this.observed = options
    }

    takeRecords(): PerformanceEntryList {
        const records = this._pending
        this._pending = []
        return records
    }

    disconnect(): void {
        this.disconnected = true
    }

    queue(...entries: Partial<PerformanceResourceTiming>[]): void {
        if (!this.disconnected) {
            this._pending.push(...(entries as PerformanceEntry[]))
        }
    }

    deliver(...entries: Partial<PerformanceResourceTiming>[]): void {
        this.queue(...entries)
        const records = this.takeRecords()
        if (records.length) {
            const list = {
                getEntries: () => records,
                getEntriesByName: (name: string) => records.filter((entry) => entry.name === name),
            }
            this._callback(list as PerformanceObserverEntryList, this as never)
        }
    }
}

export const resourceEntry = (
    name: string,
    startTime: number,
    responseEnd: number
): Partial<PerformanceResourceTiming> => ({
    name,
    entryType: 'resource',
    startTime,
    responseEnd,
})
