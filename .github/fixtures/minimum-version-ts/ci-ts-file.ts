/* oxlint-disable */
import { posthog } from 'posthog-js'
import type { Replayer, ReplayPlugin, eventWithTime as ReplayerEvent } from 'posthog-js/rrweb'
import type { EventType, customEvent, eventWithTime } from 'posthog-js/rrweb-types'
import * as ts from 'typescript'

console.log(posthog)
console.log(ts.version)

function jsonLdUrl(event: eventWithTime): string | undefined {
    const customEventType = 5
    if (event.type === customEventType && event.data.tag === '$json_ld') {
        return event.data.href
    }
    return undefined
}

console.log(jsonLdUrl({ type: 5, timestamp: 0, data: { tag: '$json_ld', payload: {}, href: 'https://example.com' } }))
console.log(jsonLdUrl({ type: 5, timestamp: 0, data: { tag: '$json_ld', payload: {} } }))

function customPayload(event: customEvent<{ name: string }>): string {
    return event.data.payload.name
}

console.log(customPayload({ type: 5, data: { tag: 'example', payload: { name: 'test' } } }))

function replayEvents(ReplayerClass: typeof Replayer, events: eventWithTime[]): eventWithTime[] {
    const plugin: ReplayPlugin = {
        handler(event: eventWithTime) {
            console.log(jsonLdUrl(event))
        },
    }
    const replayer = new ReplayerClass(events, { plugins: [plugin] })
    const event: ReplayerEvent = events[0]
    replayer.addEvent(events[0])
    const type: EventType = event.type
    console.log(type)
    return [event]
}

console.log(replayEvents)
