import { EventsPage } from '../fixtures/events'

export async function assertThatRecordingStarted(events: EventsPage) {
    const captures = events.all()

    events.expectMatchList(['$snapshot'])
    const capturedSnapshot = captures[0]

    expect(capturedSnapshot).toBeDefined()

    expect(capturedSnapshot!['properties']['$snapshot_data'].length).toBeGreaterThan(2)

    // a meta and then a full snapshot
    expect(capturedSnapshot!['properties']['$snapshot_data'][0].type).toEqual(4) // meta
    expect(capturedSnapshot!['properties']['$snapshot_data'][1].type).toEqual(2) // full_snapshot
}
