// Exposed as `posthog-js/rrweb-types` via packages/browser/rrweb-types/package.json.
// Types-only — the generated rrweb-types.js is effectively empty; the value is in the .d.ts.
export * from '@posthog/rrweb-types'

import type {
    customEvent as RrwebCustomEvent,
    eventWithoutTime as RrwebEventWithoutTime,
    eventWithTime as RrwebEventWithTime,
} from '@posthog/rrweb-types'
import type { customEvent as PostHogCustomEvent } from '../extensions/replay/types/rrweb-types'

type WithJsonLdMetadata<T> = T extends RrwebCustomEvent
    ? T & { data: Pick<PostHogCustomEvent['data'], 'fullSnapshotTimestamp' | 'href'> }
    : T

export type customEvent<T = unknown> = WithJsonLdMetadata<RrwebCustomEvent<T>>
export type eventWithoutTime = WithJsonLdMetadata<RrwebEventWithoutTime>
export type event = eventWithoutTime
export type eventWithTime = WithJsonLdMetadata<RrwebEventWithTime>
