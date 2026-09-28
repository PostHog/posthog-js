import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

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
      width: 1200,
      height: 500,
    },
    timestamp: now + 100,
  },
  // full snapshot with an input and a textarea; rebuild forces
  // autocomplete="off" on both regardless of what was recorded
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
                id: 5,
                type: 2,
                tagName: 'body',
                attributes: {},
                childNodes: [
                  {
                    id: 6,
                    type: 2,
                    tagName: 'input',
                    attributes: { type: 'text', autocomplete: 'off' },
                    childNodes: [],
                  },
                  {
                    id: 7,
                    type: 2,
                    tagName: 'textarea',
                    attributes: { autocomplete: 'off' },
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
    type: EventType.FullSnapshot,
    timestamp: now + 100,
  },
  // the recorded page re-enables autofill on the input and drops the
  // attribute from the textarea; neither may reach the replay document
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [
        {
          id: 6,
          attributes: { autocomplete: 'email' },
        },
        {
          id: 7,
          attributes: { autocomplete: null },
        },
      ],
      removes: [],
      adds: [],
    },
    timestamp: now + 150,
  },
];

export default events;
