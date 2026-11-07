/**
 * @vitest-environment jsdom
 */
import { Replayer } from '../../src/replay';
import {
  EventType,
  IncrementalSource,
  NodeType,
  type eventWithTime,
} from '@posthog/rrweb-types';

const element = (tagName: string, id: number) => ({
  type: NodeType.Element as const,
  tagName,
  attributes: {},
  childNodes: [],
  id,
  ...(tagName === 'svg' ? { isSVG: true as const } : {}),
});

const buildEvents = (oldRoot: string, newRoot: string): eventWithTime[] => [
  {
    type: EventType.FullSnapshot,
    timestamp: 1000,
    data: {
      node: {
        type: NodeType.Document,
        id: 1,
        childNodes: [element(oldRoot, 2)],
      },
      initialOffset: { top: 0, left: 0 },
    },
  },
  {
    type: EventType.IncrementalSnapshot,
    timestamp: 1010,
    data: {
      source: IncrementalSource.Mutation,
      texts: [],
      attributes: [],
      removes: [],
      adds: [{ parentId: 1, nextId: null, node: element(newRoot, 10) }],
    },
  },
  {
    type: EventType.IncrementalSnapshot,
    timestamp: 1100,
    data: {
      source: IncrementalSource.ViewportResize,
      width: 800,
      height: 600,
    },
  },
];

describe('replacing the document root element', () => {
  let replayer: Replayer;

  beforeEach(() => {
    vi.useFakeTimers();
    let ticks = 0;
    vi.spyOn(performance, 'now').mockImplementation(
      () => Date.now() + ++ticks / 1000,
    );
  });

  afterEach(() => {
    replayer?.destroy();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it.each([
    ['html', 'svg', 'live'],
    ['svg', 'html', 'live'],
    ['html', 'svg', 'fast-forward'],
    ['svg', 'html', 'fast-forward'],
  ])(
    'replaces a leftover %s root with an added %s root (%s)',
    async (oldRoot, newRoot, mode) => {
      const warn = vi.fn();
      replayer = new Replayer(buildEvents(oldRoot, newRoot), {
        logger: { ...console, warn },
      });
      vi.spyOn(replayer.iframe.contentWindow!, 'scrollTo').mockImplementation(
        () => {},
      );
      if (mode === 'live') {
        replayer.play(0);
        await vi.advanceTimersByTimeAsync(200);
      } else {
        replayer.pause(50);
        await vi.advanceTimersByTimeAsync(50);
      }

      const roots = Array.from(
        replayer.iframe.contentDocument!.childNodes,
      ).filter((child) => child.nodeType === Node.ELEMENT_NODE);
      expect(roots.map((root) => root.nodeName.toLowerCase())).toEqual([
        newRoot,
      ]);
      expect(warn).not.toHaveBeenCalled();
    },
  );
});
