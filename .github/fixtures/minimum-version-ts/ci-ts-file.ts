/* oxlint-disable */
import { posthog } from 'posthog-js'
import type { eventWithTime } from 'posthog-js/rrweb-types'
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
