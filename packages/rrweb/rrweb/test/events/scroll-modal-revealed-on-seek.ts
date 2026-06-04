import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

const now = Date.now();

// Reproduces a scroll-revealed modal (e.g. a Silk bottom sheet) whose scroll container uses
// `scroll-behavior: smooth`. The sheet is revealed by scrolling its track to the "Chimichanga" item.
// On seek/fast-forward the recorded scroll must land instantly: with `behavior: 'auto'` it inherits
// the CSS smooth behavior and animates from 0, so the seeked frame shows an empty scrim instead of
// the open sheet. The sheet lives in the full snapshot so it is laid out (and scrollable) well before
// the scroll event applies, isolating the smooth-vs-instant behavior from any layout-timing effects.
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
                  {
                    id: 100,
                    type: 2,
                    tagName: 'div',
                    attributes: {
                      id: 'sheet',
                      role: 'region',
                      style:
                        'overflow: auto; height: 400px; width: 320px; display: block; scroll-behavior: smooth;',
                    },
                    childNodes: [
                      {
                        id: 101,
                        type: 2,
                        tagName: 'div',
                        attributes: {
                          id: 'sheet-track',
                          style: 'display: block; height: 2000px;',
                        },
                        childNodes: [
                          {
                            id: 102,
                            type: 2,
                            tagName: 'h2',
                            attributes: { style: 'margin-top: 1400px;' },
                            childNodes: [
                              {
                                id: 103,
                                type: 3,
                                textContent: '126. Chimichanga',
                              },
                            ],
                          },
                        ],
                      },
                    ],
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
  // The user clicks the "Chimichanga" item and the sheet scrolls up to its resting open position.
  {
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.Scroll, id: 100, x: 0, y: 1320 },
    timestamp: now + 1000,
  },
];

export default events;
