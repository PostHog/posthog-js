import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

/**
 * Reproduces a keyed subtree swap where an add mutation arrives for a node id
 * the mirror already knows about, with changed attributes. The replayer must
 * replace the old node, not leave it in the document as a duplicate.
 */
const now = Date.now();
const events: eventWithTime[] = [
  {
    type: EventType.DomContentLoaded,
    data: {},
    timestamp: now,
  },
  {
    type: EventType.Load,
    data: {},
    timestamp: now + 100,
  },
  {
    type: EventType.Meta,
    data: {
      href: 'http://localhost',
      width: 1000,
      height: 800,
    },
    timestamp: now + 100,
  },
  {
    data: {
      node: {
        id: 1,
        type: 0,
        childNodes: [
          { id: 2, name: 'html', type: 1, publicId: '', systemId: '' },
          {
            id: 3,
            type: 2,
            tagName: 'html',
            attributes: { lang: 'en' },
            childNodes: [
              {
                id: 4,
                type: 2,
                tagName: 'head',
                attributes: {},
                childNodes: [],
              },
              {
                id: 107,
                type: 2,
                tagName: 'body',
                attributes: {},
                childNodes: [
                  {
                    id: 200,
                    type: 2,
                    tagName: 'div',
                    attributes: { id: 'container' },
                    childNodes: [
                      {
                        id: 201,
                        type: 2,
                        tagName: 'span',
                        attributes: { class: 'a' },
                        childNodes: [
                          { id: 202, type: 3, textContent: 'only me' },
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
      initialOffset: { top: 0, left: 0 },
    },
    type: EventType.FullSnapshot,
    timestamp: now + 100,
  },
  // re-add id 201 with changed attributes (a keyed swap), without a remove.
  // The mirror already holds id 201, so the replayer builds a replacement and
  // re-points the id at it. The old node must be detached so it does not stay
  // in the container as a duplicate.
  {
    data: {
      adds: [
        {
          node: {
            id: 201,
            type: 2,
            tagName: 'span',
            attributes: { class: 'b' },
            childNodes: [],
          },
          nextId: null,
          parentId: 200,
        },
        {
          node: { id: 203, type: 3, textContent: 'still only me' },
          nextId: null,
          parentId: 201,
        },
      ],
      texts: [],
      source: IncrementalSource.Mutation,
      removes: [],
      attributes: [],
    },
    type: EventType.IncrementalSnapshot,
    timestamp: now + 500,
  },
];

export default events;
