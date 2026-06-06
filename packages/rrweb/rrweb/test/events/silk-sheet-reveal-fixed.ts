import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

import brokenEvents from './silk-sheet-reveal-broken';

// Same sequence as the broken case, but with the resting offset (y=787) that
// scrollend would record once the sheet content is scrollable.
const events = [
  ...brokenEvents,
  {
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.Scroll, id: 8, x: 0, y: 787 },
    timestamp: brokenEvents[brokenEvents.length - 1].timestamp + 50,
  },
];

export default events;
