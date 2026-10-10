import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

const now = Date.now();

/**
 * Host A adopts a constructed stylesheet, sending its rules, and is then
 * removed. Host B adopts the same sheet later; the recorder only sends its
 * styleId because the rules already went out with A. This is how Ionic
 * overlays share one stylesheet per component: each modal is its own host,
 * and the first one is often gone by the time the next one opens. A seek
 * queues both AdoptedStyleSheet events and applies them after host A is gone.
 */
const events: eventWithTime[] = [
  { type: EventType.DomContentLoaded, data: {}, timestamp: now },
  {
    type: EventType.Meta,
    data: {
      href: 'about:blank',
      width: 1920,
      height: 1080,
    },
    timestamp: now + 100,
  },
  {
    type: EventType.FullSnapshot,
    data: {
      node: {
        type: 0,
        childNodes: [
          {
            type: 1,
            name: 'html',
            publicId: '',
            systemId: '',
            id: 2,
          },
          {
            type: 2,
            tagName: 'html',
            attributes: {},
            childNodes: [
              {
                type: 2,
                tagName: 'head',
                attributes: {},
                childNodes: [],
                id: 4,
              },
              {
                type: 2,
                tagName: 'body',
                attributes: {},
                childNodes: [
                  {
                    type: 2,
                    tagName: 'div',
                    attributes: { id: 'app' },
                    childNodes: [
                      {
                        type: 2,
                        tagName: 'shared-style-host',
                        attributes: { id: 'host-a' },
                        isShadowHost: true,
                        childNodes: [],
                        id: 7,
                      },
                    ],
                    id: 6,
                  },
                ],
                id: 5,
              },
            ],
            id: 3,
          },
        ],
        id: 1,
      },
      initialOffset: {
        left: 0,
        top: 0,
      },
    },
    timestamp: now + 100,
  },
  // any mutation first, so a seek switches to the virtual DOM and queues the
  // AdoptedStyleSheet events below until its flush
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [{ id: 6, attributes: { 'data-ready': 'true' } }],
      removes: [],
      adds: [],
    },
    timestamp: now + 105,
  },
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.AdoptedStyleSheet,
      id: 7,
      styleIds: [1],
      styles: [
        {
          rules: [
            {
              rule: ':host { display: block; height: 10px; background-color: rgb(0, 0, 0); }',
            },
          ],
          styleId: 1,
        },
      ],
    },
    timestamp: now + 110,
  },
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [],
      removes: [{ parentId: 6, id: 7 }],
      adds: [],
    },
    timestamp: now + 150,
  },
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [],
      removes: [],
      adds: [
        {
          parentId: 6,
          nextId: null,
          node: {
            type: 2,
            tagName: 'shared-style-host',
            attributes: { id: 'host-b' },
            isShadowHost: true,
            childNodes: [],
            id: 8,
          },
        },
      ],
    },
    timestamp: now + 400,
  },
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.AdoptedStyleSheet,
      id: 8,
      styleIds: [1],
    },
    timestamp: now + 410,
  },
  {
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.MouseMove, positions: [] },
    timestamp: now + 600,
  },
];

export default events;
