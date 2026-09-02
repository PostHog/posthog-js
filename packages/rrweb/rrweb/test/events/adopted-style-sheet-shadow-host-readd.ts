import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

const now = Date.now();

/**
 * A shadow host adopts a stylesheet, then an SPA navigation removes an
 * ancestor and re-adds the same subtree with the same mirror ids. The
 * recorder emits no new AdoptedStyleSheet event for the tracked shadow root.
 */
const baseEvents: eventWithTime[] = [
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
                        tagName: 'late-shadow-host',
                        attributes: {},
                        isShadowHost: true,
                        childNodes: [
                          {
                            type: 2,
                            tagName: 'nav',
                            attributes: {},
                            isShadow: true,
                            childNodes: [
                              {
                                type: 2,
                                tagName: 'a',
                                attributes: { href: '#' },
                                childNodes: [
                                  {
                                    type: 3,
                                    textContent: 'menu item',
                                    id: 10,
                                  },
                                ],
                                id: 9,
                              },
                            ],
                            id: 8,
                          },
                        ],
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
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.AdoptedStyleSheet,
      id: 7,
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
];

const removes = [{ parentId: 5, id: 6 }];

const adds = [
  {
    parentId: 5,
    nextId: null,
    node: {
      type: 2,
      tagName: 'div',
      attributes: { id: 'app' },
      childNodes: [],
      id: 6,
    },
  },
  {
    parentId: 6,
    nextId: null,
    node: {
      type: 2,
      tagName: 'late-shadow-host',
      attributes: {},
      childNodes: [],
      id: 7,
    },
  },
  {
    parentId: 7,
    nextId: null,
    node: {
      type: 2,
      tagName: 'nav',
      attributes: {},
      childNodes: [],
      id: 8,
      isShadow: true,
    },
  },
  {
    parentId: 8,
    nextId: null,
    node: {
      type: 2,
      tagName: 'a',
      attributes: { href: '#' },
      childNodes: [],
      id: 9,
    },
  },
  {
    parentId: 9,
    nextId: null,
    node: {
      type: 3,
      textContent: 'menu item',
      id: 10,
    },
  },
];

const events: eventWithTime[] = [
  ...baseEvents,
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [],
      removes,
      adds,
    },
    timestamp: now + 200,
  },
];

/**
 * Same scenario, but the page clears adoptedStyleSheets while the host is
 * detached, so the re-added shadow root must end up with no adopted sheets.
 */
export const eventsWithClearWhileDetached: eventWithTime[] = [
  ...baseEvents,
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [],
      removes,
      adds: [],
    },
    timestamp: now + 150,
  },
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.AdoptedStyleSheet,
      id: 7,
      styleIds: [],
    },
    timestamp: now + 160,
  },
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [],
      removes: [],
      adds,
    },
    timestamp: now + 200,
  },
];

export default events;
