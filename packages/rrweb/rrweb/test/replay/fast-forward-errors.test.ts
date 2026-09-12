/**
 * @vitest-environment jsdom
 */
import { Replayer } from '../../src/replay';
import {
  EventType,
  IncrementalSource,
  NodeType,
  ReplayerEvents,
  type eventWithTime,
} from '@posthog/rrweb-types';

const mutation = (
  timestamp: number,
  attribute: string,
): eventWithTime => ({
  type: EventType.IncrementalSnapshot,
  timestamp,
  data: {
    source: IncrementalSource.Mutation,
    adds: [],
    removes: [],
    texts: [],
    attributes: [{ id: 3, attributes: { [attribute]: 'yes' } }],
  },
});

const events: eventWithTime[] = [
  {
    type: EventType.FullSnapshot,
    timestamp: 1000,
    data: {
      node: {
        type: NodeType.Document,
        id: 1,
        childNodes: [
          {
            type: NodeType.Element,
            tagName: 'html',
            attributes: {},
            id: 2,
            childNodes: [
              {
                type: NodeType.Element,
                tagName: 'body',
                attributes: {},
                id: 3,
                childNodes: [],
              },
            ],
          },
        ],
      },
      initialOffset: { top: 0, left: 0 },
    },
  },
  mutation(1010, 'data-before'),
  {
    type: EventType.IncrementalSnapshot,
    timestamp: 1020,
    data: {
      source: IncrementalSource.ViewportResize,
      width: 800,
      height: 600,
    },
  },
  mutation(1030, 'data-after'),
  mutation(1100, 'data-playback'),
];

describe('fast-forward errors', () => {
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

  it.each([0, 0.0001])(
    'flushes and continues playback after a failed cast (budget %s)',
    async (seekYieldBudgetMs) => {
      const error = new TypeError("can't access dead object");
      const warn = vi.fn();
      const handler = vi.fn((event: eventWithTime) => {
        if (event.timestamp === 1020) throw error;
      });
      replayer = new Replayer(events, {
        seekYieldBudgetMs,
        logger: { ...console, warn },
        plugins: [{ handler }],
      });
      vi.spyOn(
        replayer.iframe.contentWindow!,
        'scrollTo',
      ).mockImplementation(() => {});
      const order: string[] = [];
      replayer.on(ReplayerEvents.Flush, () => order.push('flush'));
      replayer.on(ReplayerEvents.Finish, () => order.push('finish'));

      expect(() => replayer.play(35)).not.toThrow();
      await vi.advanceTimersByTimeAsync(300);

      expect(
        handler.mock.calls.some(([event]) => event.timestamp === 1020),
      ).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        '[replayer]',
        'Exception in fast-forward event',
        error,
      );
      expect(order).toEqual(['flush', 'finish']);
      expect(replayer.service.state.matches('paused')).toBe(true);
      expect(replayer.usingVirtualDom).toBe(false);
      const body = replayer.iframe.contentDocument!.body;
      expect(body.getAttribute('data-before')).toBe('yes');
      expect(body.getAttribute('data-after')).toBe('yes');
      expect(body.getAttribute('data-playback')).toBe('yes');
    },
  );

  it.each([0, 0.0001])(
    'rebuilds a failed seek on the next play even after later events succeed (budget %s)',
    async (seekYieldBudgetMs) => {
      let failed = false;
      const handler = vi.fn((event: eventWithTime) => {
        if (event.timestamp === 1020 && !failed) {
          failed = true;
          throw new Error('transient cast failure');
        }
      });
      replayer = new Replayer([...events, mutation(2000, 'data-end')], {
        seekYieldBudgetMs,
        showWarning: false,
        plugins: [{ handler }],
      });
      vi.spyOn(
        replayer.iframe.contentWindow!,
        'scrollTo',
      ).mockImplementation(() => {});

      replayer.play(35);
      await vi.advanceTimersByTimeAsync(300);
      expect(
        handler.mock.calls.some(([event]) => event.timestamp === 1100),
      ).toBe(true);

      expect(replayer.service.state.matches('playing')).toBe(true);
      replayer.pause(150);
      await vi.advanceTimersByTimeAsync(300);

      expect(
        handler.mock.calls.filter(([event]) => event.timestamp === 1010),
      ).toHaveLength(2);
      expect(
        handler.mock.calls.filter(([event]) => event.timestamp === 1020),
      ).toHaveLength(2);
      expect(replayer.service.state.matches('paused')).toBe(true);

      replayer.pause(160);
      await vi.advanceTimersByTimeAsync(300);
      expect(
        handler.mock.calls.filter(([event]) => event.timestamp === 1010),
      ).toHaveLength(2);
    },
  );

  it.each([0, 0.0001])(
    'does not invalidate a newer seek when a superseded cast throws (budget %s)',
    async (seekYieldBudgetMs) => {
      let superseded = false;
      const handler = vi.fn((event: eventWithTime) => {
        if (event.timestamp === 1020 && !superseded) {
          superseded = true;
          replayer.pause(150);
          throw new Error('superseded cast failure');
        }
      });
      replayer = new Replayer([...events, mutation(2000, 'data-end')], {
        seekYieldBudgetMs,
        showWarning: false,
        plugins: [{ handler }],
      });
      vi.spyOn(
        replayer.iframe.contentWindow!,
        'scrollTo',
      ).mockImplementation(() => {});
      const flushed = vi.fn();
      replayer.on(ReplayerEvents.Flush, flushed);

      replayer.play(35);
      await vi.advanceTimersByTimeAsync(300);
      expect(flushed).toHaveBeenCalledTimes(1);
      expect(replayer.service.state.matches('paused')).toBe(true);

      replayer.pause(160);
      await vi.advanceTimersByTimeAsync(300);
      expect(
        handler.mock.calls.filter(([event]) => event.timestamp === 1010),
      ).toHaveLength(2);
    },
  );
});
