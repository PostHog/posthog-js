import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { addedNodeMutation, eventWithTime } from '@posthog/rrweb-types';

const now = Date.now();
const HEAD_ID = 4;
const HEAD_STYLE_ID = 6;
const DIV_ID = 10;
const DIV_STYLE_ID = 11;

const metaAdds = (parentId: number, count: number): addedNodeMutation[] =>
  Array.from({ length: count }, (_, i) => ({
    parentId,
    nextId: null,
    node: {
      id: 1000 + i,
      type: 2,
      tagName: 'meta',
      attributes: { name: `m${i}` },
      childNodes: [],
    },
  }));

/**
 * Rules reach both <style> elements through the CSSOM, then one batch large
 * enough for the detached-subtree path lands in `batchParentId`.
 */
const hugeAddCssomRulesEvents = (batchParentId: number): eventWithTime[] => [
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
                id: HEAD_ID,
                type: 2,
                tagName: 'head',
                attributes: {},
                childNodes: [
                  {
                    id: HEAD_STYLE_ID,
                    type: 2,
                    tagName: 'style',
                    attributes: { id: 'head-style' },
                    childNodes: [
                      {
                        id: 7,
                        type: 3,
                        // cssText of this rule round-trips lossily
                        textContent:
                          '.padded { padding: var(--a); padding-top: var(--b); }',
                        isStyle: true,
                      },
                    ],
                  },
                ],
              },
              {
                id: 5,
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
                        id: DIV_STYLE_ID,
                        type: 2,
                        tagName: 'style',
                        attributes: { id: 'div-style' },
                        childNodes: [],
                      },
                    ],
                  },
                  {
                    id: 12,
                    type: 2,
                    tagName: 'div',
                    attributes: {
                      id: 'padded',
                      class: 'padded',
                      style: '--a: 7px; --b: 3px',
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
    timestamp: now + 20,
  },
  ...[HEAD_STYLE_ID, DIV_STYLE_ID].map((id) => ({
    type: EventType.IncrementalSnapshot as const,
    data: {
      source: IncrementalSource.StyleSheetRule as const,
      id,
      adds: [{ rule: `.from-${id} { color: red; }`, index: 0 }],
    },
    timestamp: now + 30,
  })),
  {
    type: EventType.IncrementalSnapshot,
    data: {
      source: IncrementalSource.Mutation,
      adds: metaAdds(batchParentId, 1100),
      removes: [],
      texts: [],
      attributes: [],
    },
    timestamp: now + 40,
  },
];

export { HEAD_ID, DIV_ID };
export default hugeAddCssomRulesEvents;
