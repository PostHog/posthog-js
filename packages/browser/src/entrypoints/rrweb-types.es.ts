// Exposed as `posthog-js/rrweb-types` via packages/browser/rrweb-types/package.json.
// Types-only — the generated rrweb-types.js is effectively empty; the value is in the .d.ts.
export * from '@posthog/rrweb-types'

import type {
    customEvent as RrwebCustomEvent,
    eventWithoutTime as RrwebEventWithoutTime,
    eventWithTime as RrwebEventWithTime,
} from '@posthog/rrweb-types'
import type { customEventData } from '../extensions/replay/types/rrweb-types'

// Sharing only event data avoids bundling the internal EventType and renaming rrweb's enum.
type WithJsonLdUrl<T> = T extends RrwebCustomEvent ? T & { data: Pick<customEventData, 'href'> } : T

export type customEvent<T = unknown> = WithJsonLdUrl<RrwebCustomEvent<T>>
export type eventWithoutTime = WithJsonLdUrl<RrwebEventWithoutTime>
export type event = eventWithoutTime
export type eventWithTime = WithJsonLdUrl<RrwebEventWithTime>
