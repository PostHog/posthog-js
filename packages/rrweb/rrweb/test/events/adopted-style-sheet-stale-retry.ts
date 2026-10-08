import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

const now = Date.now();

/**
 * Same shadow-root race as adopted-style-sheet-before-shadow-root, followed by
 * a second AdoptedStyleSheet event for the same host after the shadow root is
 * attached. The first event's wall-clock retries (armed at ~110ms, backoff
 * fires at ~110/210/410/710/1110/1610ms) are still alive when the second event
 * applies at 1450ms, so the ~1610ms retry would overwrite the newer stylesheet
 * list with the stale one.
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
                    tagName: 'late-shadow-host',
                    attributes: {},
                    childNodes: [],
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
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.AdoptedStyleSheet,
      id: 6,
      styleIds: [1],
      styles: [
        {
          rules: [
            { rule: ':host { display: block; }' },
            { rule: 'nav { display: flex; }' },
            { rule: 'a { color: rgb(255, 0, 0); }' },
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
      removes: [],
      adds: [
        {
          parentId: 6,
          nextId: null,
          node: {
            type: 2,
            tagName: 'nav',
            attributes: {},
            childNodes: [],
            id: 7,
            isShadow: true,
          },
        },
        {
          parentId: 7,
          nextId: null,
          node: {
            type: 2,
            tagName: 'a',
            attributes: { href: '#' },
            childNodes: [],
            id: 8,
          },
        },
        {
          parentId: 8,
          nextId: null,
          node: {
            type: 3,
            textContent: 'menu item',
            id: 9,
          },
        },
      ],
    },
    timestamp: now + 1250,
  },
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.AdoptedStyleSheet,
      id: 6,
      styleIds: [2],
      styles: [
        {
          rules: [
            { rule: ':host { display: block; }' },
            { rule: 'a { color: rgb(0, 0, 255); }' },
          ],
          styleId: 2,
        },
      ],
    },
    timestamp: now + 1450,
  },
];

export default events;
