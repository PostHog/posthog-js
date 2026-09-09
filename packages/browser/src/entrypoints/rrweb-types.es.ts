// Exposed as `posthog-js/rrweb-types` via packages/browser/rrweb-types/package.json.
// Types-only — the generated rrweb-types.js is effectively empty; the value is in the .d.ts.
export * from '@posthog/rrweb-types'

import type {
    customEvent as RrwebCustomEvent,
    eventWithoutTime as RrwebEventWithoutTime,
    eventWithTime as RrwebEventWithTime,
} from '@posthog/rrweb-types'

// Importing internal event types also bundles their EventType, breaking compatibility with the replayer's enum.
type WithJsonLdUrl<T> = T extends RrwebCustomEvent ? T & { data: { href?: string } } : T

export type customEvent<T = unknown> = WithJsonLdUrl<RrwebCustomEvent<T>>
export type eventWithoutTime = WithJsonLdUrl<RrwebEventWithoutTime>
export type event = eventWithoutTime
export type eventWithTime = WithJsonLdUrl<RrwebEventWithTime>
