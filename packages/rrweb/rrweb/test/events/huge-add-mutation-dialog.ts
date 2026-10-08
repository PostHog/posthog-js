import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { addedNodeMutation, eventWithTime } from '@posthog/rrweb-types';

const now = Date.now();

const BODY_ID = 5;
const DIV_ID = 10;
const SPAN_B_ID = 13;
const DIALOG_ID = 20;

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
  // batch large enough for the detached-ancestor path, carrying a modal
  // dialog: showModal() must still land once the root reattaches
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      adds: [
        ...styleAdds(1100, 1000, 3000, 'm1c'),
        {
          parentId: DIV_ID,
          nextId: SPAN_B_ID,
          node: {
            id: DIALOG_ID,
            type: 2,
            tagName: 'dialog',
            attributes: { open: '', rr_open_mode: 'modal' },
            childNodes: [],
          },
        },
      ],
      removes: [],
      texts: [],
      attributes: [],
    },
    timestamp: now + 30,
  },
];

export default events;
