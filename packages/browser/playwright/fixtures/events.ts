import { expect } from '@playwright/test'
import { CaptureResult } from '../../src/types'
import { BasePage, WaitOptions } from './page'
import { testNetwork } from './network'

export const testEvents = testNetwork.extend<{ events: EventsPage }>({
    events: async ({ page }, use) => {
        const eventsPage = new EventsPage(page)
        await use(eventsPage)
        eventsPage.clear()
    },
})

export class EventsPage {
    eventStore: CaptureResult[] = []

    constructor(private page: BasePage) {}

    addEvent(event: CaptureResult) {
        event.timestamp = event.timestamp ? new Date(event.timestamp) : undefined
        this.eventStore.push(event)
    }

    sort() {
        this.eventStore.sort((a, b) => {
            if (!a.timestamp && !b.timestamp) return 0
            if (!a.timestamp) return 1
            if (!b.timestamp) return -1
            return a.timestamp.getTime() - b.timestamp.getTime()
        })
    }

    some(predicate: (event: CaptureResult) => boolean): boolean {
        return this.eventStore.some(predicate)
    }

    get(index: number): CaptureResult | null {
        return this.eventStore[index] ?? null
    }

    first(): CaptureResult | null {
        return this.eventStore[0] ?? null
    }

    find(predicate: (event: CaptureResult) => boolean): CaptureResult | null {
        return this.eventStore.find(predicate) ?? null
    }

    findByName(name: string): CaptureResult | null {
        return this.find((event) => event.event === name)
    }

    filter(predicate: (event: CaptureResult) => boolean): CaptureResult[] {
        return this.eventStore.filter(predicate)
    }

    filterByName(name: string): CaptureResult[] {
        return this.filter((event) => event.event === name)
    }

    getLastEventByName(name: string): CaptureResult | null {
        return this.filterByName(name).pop() ?? null
    }

    count(predicate: (event: CaptureResult) => boolean): number {
        const results = this.filter(predicate)
        return results.length
    }

    all(): CaptureResult[] {
        return this.eventStore
    }

    countByName(name: string): number {
        return this.count((evt) => evt.event === name)
    }

    getCountMap(): Record<string, number> {
        return this.eventStore.reduce(
            (acc, event) => {
                acc[event.event] = (acc[event.event] || 0) + 1
                return acc
            },
            {} as Record<string, number>
        )
    }

    async waitForEvent(name: string, options?: Partial<WaitOptions>): Promise<CaptureResult> {
        await this.page.waitForCondition(() => this.eventStore.some((event) => event.event === name), options)
        return this.findByName(name)!
    }

    expectCountMap(expectedMap: Record<string, number>) {
        const counts = this.getCountMap()
        expect(counts).toMatchObject(expectedMap)
    }

    clear(): void {
        this.eventStore = []
    }

    expectMatchList(expectedEvents: string[]) {
        const capturedEvents = this.all()
        expect(capturedEvents.map((x) => x.event)).toMatchObject(expectedEvents)
    }

    expectRecordingStarted(count: number = 1) {
        const snapshotCount = this.countByName('$snapshot')
        expect(snapshotCount).toBe(count)
        const snapshotEvent = this.findByName('$snapshot')
        expect(snapshotEvent).toBeDefined()
        expect(snapshotEvent!['properties']['$snapshot_data'].length).toBeGreaterThan(2)
        // a meta and then a full snapshot
        expect(snapshotEvent!['properties']['$snapshot_data'][0].type).toEqual(4) // meta
        expect(snapshotEvent!['properties']['$snapshot_data'][1].type).toEqual(2) // full_snapshot
    }
}
