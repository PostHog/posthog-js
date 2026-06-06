import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

const now = Date.now();

// Minimal replay of a Silk scroll-reveal sheet bug: the reveal container's scroll
// was recorded as y=0 and no scrollend carried the resting offset.
const events: eventWithTime[] = [
  { type: EventType.DomContentLoaded, data: {}, timestamp: now },
  { type: EventType.Load, data: {}, timestamp: now + 100 },
  {
    type: EventType.Meta,
    data: { href: 'http://localhost', width: 390, height: 699 },
    timestamp: now + 100,
  },
  {
    type: EventType.FullSnapshot,
    data: {
      node: {
        id: 1,
        type: 0,
        childNodes: [
          { type: 1, name: 'html', publicId: '', systemId: '', id: 2 },
          {
            id: 3,
            type: 2,
            tagName: 'html',
            attributes: {},
            childNodes: [
              { id: 4, type: 2, tagName: 'head', attributes: {}, childNodes: [] },
              {
                id: 7,
                type: 2,
                tagName: 'body',
                attributes: {},
                childNodes: [
                  {
                    id: 8,
                    type: 2,
                    tagName: 'div',
                    attributes: {
                      id: 'reveal-container',
                      style:
                        'overflow: auto; height: 100px; width: 100%; display: block;',
                    },
                    childNodes: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      initialOffset: { left: 0, top: 0 },
    },
    timestamp: now + 100,
  },
  // Sheet content mounts (not scrollable yet).
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [],
      removes: [],
      adds: [
        {
          parentId: 8,
          nextId: null,
          node: {
            id: 9,
            type: 2,
            tagName: 'div',
            attributes: { id: 'sheet-content', style: 'height: 10px;' },
            childNodes: [],
          },
        },
      ],
    },
    timestamp: now + 500,
  },
  // Reveal scroll recorded as y=0 (clamped).
  {
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.Scroll, id: 8, x: 0, y: 0 },
    timestamp: now + 600,
  },
  // Content grows; container is scrollable now but no follow-up scroll was recorded.
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [
        {
          id: 9,
          attributes: { style: 'height: 3000px;' },
        },
      ],
      removes: [],
      adds: [],
    },
    timestamp: now + 700,
  },
];

export default events;
