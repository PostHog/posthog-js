import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

const now = Date.now();

// Scroll that clamps to 0 mid-fast-forward: the target only becomes scrollable via a stylesheet
// applied after the scroll. Mirrors scroll-revealed sheets/modals whose content sits below the fold.
const events: eventWithTime[] = [
  { type: EventType.DomContentLoaded, data: {}, timestamp: now },
  { type: EventType.Load, data: {}, timestamp: now + 100 },
  {
    type: EventType.Meta,
    data: { href: 'http://localhost', width: 1200, height: 500 },
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
                      id: 'container',
                      style:
                        'overflow: auto; height: 100px; width: 100px; display: block;',
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
  // Add the (initially zero-height) content. This triggers the virtual-dom fast-forward path.
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
            attributes: { id: 'tall' },
            childNodes: [],
          },
        },
      ],
    },
    timestamp: now + 500,
  },
  // Scroll the container. At apply time #tall has no height yet, so this clamps to 0.
  {
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.Scroll, id: 8, x: 0, y: 800 },
    timestamp: now + 1000,
  },
  // Adopted stylesheet gives #tall its height, making the container scrollable. Applied after
  // the DOM diff in the flush stage, i.e. after the scroll above was already applied.
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.AdoptedStyleSheet,
      id: 1,
      styleIds: [1],
      styles: [{ rules: [{ rule: '#tall { display: block; height: 2000px; }' }], styleId: 1 }],
    },
    timestamp: now + 1500,
  },
];

export default events;
