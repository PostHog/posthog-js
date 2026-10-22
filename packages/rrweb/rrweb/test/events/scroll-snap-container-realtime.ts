import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

const now = Date.now();

const container = (
  id: number,
  elementId: string,
  style: string,
  childStyle: string,
) => ({
  id,
  type: 2,
  tagName: 'div',
  attributes: { id: elementId, style },
  childNodes: [
    {
      id: id + 1,
      type: 2,
      tagName: 'div',
      attributes: { style: `height: 1320px; ${childStyle}` },
      childNodes: [],
    },
    {
      id: id + 2,
      type: 2,
      tagName: 'div',
      attributes: { style: `height: 1000px; ${childStyle}` },
      childNodes: [],
    },
  ],
});

const events: eventWithTime[] = [
  { type: EventType.DomContentLoaded, data: {}, timestamp: now },
  { type: EventType.Load, data: {}, timestamp: now + 100 },
  {
    type: EventType.Meta,
    data: { href: 'http://localhost', width: 1200, height: 600 },
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
                  container(
                    100,
                    'snap',
                    'overflow: auto; height: 400px; width: 320px; scroll-snap-type: y mandatory;',
                    'scroll-snap-align: start;',
                  ),
                  container(
                    200,
                    'plain',
                    'overflow: auto; height: 400px; width: 320px;',
                    '',
                  ),
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
  {
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.Scroll, id: 100, x: 0, y: 1320 },
    timestamp: now + 1000,
  },
  {
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.Scroll, id: 200, x: 0, y: 1320 },
    timestamp: now + 1000,
  },
  {
    type: EventType.Custom,
    data: { tag: 'end', payload: {} },
    timestamp: now + 3000,
  },
];

export default events;
