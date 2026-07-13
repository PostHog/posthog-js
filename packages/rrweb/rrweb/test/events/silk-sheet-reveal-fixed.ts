import { EventType, IncrementalSource } from '@posthog/rrweb-types'
import type { eventWithTime } from '@posthog/rrweb-types'

import brokenEvents from './silk-sheet-reveal-broken'

// Broken case plus the resting offset scrollend would have recorded.
const events = [
    ...brokenEvents,
    {
        type: EventType.IncrementalSnapshot,
        data: { source: IncrementalSource.Scroll, id: 8, x: 0, y: 787 },
        timestamp: brokenEvents[brokenEvents.length - 1].timestamp + 50,
    },
]

export default events
