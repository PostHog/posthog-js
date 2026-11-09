/**
 * @vitest-environment jsdom
 */
import { snapshot } from '@posthog/rrweb-snapshot';
import {
  EventType,
  IncrementalSource,
  NodeType,
  type eventWithTime,
  type mutationData,
} from '@posthog/rrweb-types';
import { Replayer } from '../../src/replay';

describe.each([false, true])(
  'invalid mutation parents (virtual DOM: %s)',
  (isSync) => {
    let replayer: Replayer;
    let warn: ReturnType<typeof vi.fn>;
    let ids: {
      body: number;
      parent: number;
      child: number;
      sibling: number;
      text: number;
      comment: number;
    };

    beforeEach(() => {
      const event: eventWithTime = {
        type: EventType.DomContentLoaded,
        timestamp: 1,
        data: {},
      };
      warn = vi.fn();
      replayer = new Replayer([event, event], { logger: { ...console, warn } });
      const doc = replayer.iframe.contentDocument!;
      doc.body.innerHTML =
        '<div><span></span><b></b></div><p>leaf<!-- comment --></p>';
      snapshot(doc, { mirror: replayer.mirror });
      const id = (node: Node) => replayer.mirror.getId(node);
      ids = {
        body: id(doc.body),
        parent: id(doc.querySelector('div')!),
        child: id(doc.querySelector('span')!),
        sibling: id(doc.querySelector('b')!),
        text: id(doc.querySelector('p')!.firstChild!),
        comment: id(doc.querySelector('p')!.lastChild!),
      };
    });

    afterEach(() => {
      replayer.destroy();
      document.body.innerHTML = '';
    });

    function apply(data: Partial<mutationData>) {
      (
        replayer as unknown as {
          applyMutation: (data: mutationData, isSync: boolean) => void;
        }
      ).applyMutation(
        {
          source: IncrementalSource.Mutation,
          removes: [],
          adds: [],
          texts: [],
          attributes: [],
          ...data,
        },
        isSync,
      );
    }

    const mirror = () =>
      replayer.usingVirtualDom ? replayer.virtualDom.mirror : replayer.mirror;

    it.each(['body', 'text'] as const)(
      'skips a removal from the wrong %s parent and applies later changes',
      (parent) => {
        const target = replayer.mirror.getNode(ids.child)!;
        const originalParent = target.parentNode;
        expect(() =>
          apply({
            removes: [
              { id: ids.child, parentId: ids[parent] },
              { id: ids.sibling, parentId: ids.parent },
            ],
            attributes: [{ id: ids.body, attributes: { 'data-after': 'yes' } }],
          }),
        ).not.toThrow();
        expect(mirror().getNode(ids.sibling)).toBeNull();
        expect(mirror().getNode(ids.parent)!.childNodes).toHaveLength(1);
        expect(mirror().getNode(ids.parent)!.firstChild!.nodeName).toBe('SPAN');
        expect(
          (mirror().getNode(ids.body) as Element).getAttribute('data-after'),
        ).toBe('yes');
        if (!isSync) expect(target.parentNode).toBe(originalParent);
        expect(warn).toHaveBeenCalled();
      },
    );

    it.each(['text', 'comment'] as const)(
      'skips an addition to a %s node and applies later changes',
      (parent) => {
        const node = (id: number) => ({
          type: NodeType.Element as const,
          id,
          tagName: 'span',
          attributes: {},
          childNodes: [],
        });
        expect(() =>
          apply({
            adds: [
              { parentId: ids[parent], nextId: null, node: node(1001) },
              { parentId: ids.body, nextId: null, node: node(1002) },
            ],
            attributes: [{ id: ids.body, attributes: { 'data-after': 'yes' } }],
          }),
        ).not.toThrow();
        expect(mirror().getNode(1001)).toBeNull();
        expect(mirror().getNode(1002)?.parentNode).toBe(
          mirror().getNode(ids.body),
        );
        expect(
          (mirror().getNode(ids.body) as Element).getAttribute('data-after'),
        ).toBe('yes');
        expect(warn).toHaveBeenCalled();
      },
    );
  },
);
