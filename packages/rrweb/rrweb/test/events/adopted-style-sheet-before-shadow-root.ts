import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

const now = Date.now();

/**
 * A web component host serialized into the full snapshot BEFORE its shadow
 * root was attached (no isShadowHost, no shadow children). The
 * AdoptedStyleSheet event for the host arrives before the mutation that
 * attaches the shadow root, which happens when the recorder's full snapshot
 * races the component's hydration (e.g. Stencil/Lit components styled via
 * shadowRoot.adoptedStyleSheets).
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
                    tagName: 'shared-header',
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
            textContent: 'Products',
            id: 9,
          },
        },
      ],
    },
    timestamp: now + 120,
  },
];

export default events;
