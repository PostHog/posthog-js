import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { addedNodeMutation, eventWithTime } from '@posthog/rrweb-types';

const now = Date.now();

const BODY_ID = 5;
const DIV_ID = 10;
const SPAN_B_ID = 13;
const SIBLING_SPAN_ID = 20;

/**
 * Interleaved style/text pairs mirroring how a page injecting many
 * stylesheets records: each style element chained before an existing
 * sibling, each text node parented to a style added in the same batch.
 */
const styleAdds = (
  count: number,
  firstStyleId: number,
  firstTextId: number,
  classPrefix: string,
): addedNodeMutation[] => {
  const adds: addedNodeMutation[] = [];
  for (let i = 0; i < count; i++) {
    adds.push({
      parentId: DIV_ID,
      nextId: SPAN_B_ID,
      node: {
        id: firstStyleId + i,
        type: 2,
        tagName: 'style',
        attributes: {},
        childNodes: [],
      },
    });
    adds.push({
      parentId: firstStyleId + i,
      nextId: null,
      node: {
        id: firstTextId + i,
        type: 3,
        textContent: `.${classPrefix}${i} { color: red; }`,
        isStyle: true,
      },
    });
  }
  return adds;
};

const events: eventWithTime[] = [
  { type: EventType.DomContentLoaded, data: {}, timestamp: now },
  { type: EventType.Load, data: {}, timestamp: now + 10 },
  {
    type: EventType.Meta,
    data: { href: 'http://localhost', width: 1000, height: 800 },
    timestamp: now + 10,
  },
  {
    type: EventType.FullSnapshot,
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
            attributes: {},
            childNodes: [
              {
                id: 4,
                type: 2,
                tagName: 'head',
                attributes: {},
                childNodes: [],
              },
              {
                id: BODY_ID,
                type: 2,
                tagName: 'body',
                attributes: {},
                childNodes: [
                  {
                    id: DIV_ID,
                    type: 2,
                    tagName: 'div',
                    attributes: { id: 'root' },
                    childNodes: [
                      {
                        id: 11,
                        type: 2,
                        tagName: 'span',
                        attributes: {},
                        childNodes: [{ id: 12, type: 3, textContent: 'A' }],
                      },
                      {
                        id: SPAN_B_ID,
                        type: 2,
                        tagName: 'span',
                        attributes: {},
                        childNodes: [{ id: 14, type: 3, textContent: 'B' }],
                      },
                    ],
                  },
                  {
                    id: 15,
                    type: 2,
                    tagName: 'span',
                    attributes: { id: 'd-span' },
                    childNodes: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      initialOffset: { top: 0, left: 0 },
    },
    timestamp: now + 20,
  },
  // batch large enough for the detached-ancestor path
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      adds: styleAdds(1100, 1000, 3000, 'm1c'),
      removes: [],
      texts: [],
      attributes: [],
    },
    timestamp: now + 30,
  },
  // same size class, but one add is a sibling of the batch root, which
  // must force the live path to keep its position correct
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      adds: [
        ...styleAdds(600, 5000, 6000, 'm2c'),
        // belongs between the batch root and #d-span: with the root
        // detached, sibling resolution would misplace it
        {
          parentId: BODY_ID,
          nextId: 15,
          node: {
            id: SIBLING_SPAN_ID,
            type: 2,
            tagName: 'span',
            attributes: { id: 'c-span' },
            childNodes: [],
          },
        },
      ],
      removes: [],
      texts: [],
      attributes: [],
    },
    timestamp: now + 60,
  },
];

export default events;
