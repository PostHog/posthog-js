/**
 * @vitest-environment jsdom
 */
import { Replayer } from '../../src/replay';
import { Timer } from '../../src/replay/timer';
import {
  EventType,
  IncrementalSource,
  eventWithTime,
  incrementalSnapshotEvent,
} from '@posthog/rrweb-types';

const event = (timestamp = 1): eventWithTime => ({
  timestamp,
  type: EventType.DomContentLoaded,
  data: {},
});

const scroll = (
  id: number,
): incrementalSnapshotEvent & { timestamp: number; delay?: number } =>
  ({
    timestamp: 1,
    delay: 0,
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.Scroll, id, x: 0, y: 0 },
  } as unknown as incrementalSnapshotEvent & {
    timestamp: number;
    delay?: number;
  });

describe('an action that throws', () => {
  it('does not stop the actions behind it', () => {
    const onActionError = vi.fn();
    const ran: string[] = [];
    const timer = new Timer([], { speed: 1, onActionError });
    const dead = new Error("can't access dead object");

    timer.start();

    timer.addAction({
      delay: 0,
      doAction: () => {
        throw dead;
      },
    });
    timer.addAction({ delay: 0, doAction: () => ran.push('after') });

    expect(() =>
      (timer as unknown as { rafCheck: () => void }).rafCheck(),
    ).not.toThrow();
    expect(ran).toEqual(['after']);
    expect(onActionError).toHaveBeenCalledWith(dead);

    timer.clear();
  });
});

describe('an incremental event that arrives after teardown', () => {
  let replayer: Replayer;

  beforeEach(() => {
    // Replayer needs at least 2 events.
    replayer = new Replayer([event(), event()]);
  });

  it('touches no mirrored node once the player document is gone', () => {
    const getNode = vi.spyOn(replayer.getMirror(), 'getNode');
    Object.defineProperty(replayer.iframe, 'contentDocument', {
      get: () => null,
    });

    expect(() =>
      (
        replayer as unknown as {
          applyIncremental: (
            e: incrementalSnapshotEvent & { timestamp: number },
            isSync: boolean,
          ) => void;
        }
      ).applyIncremental(scroll(3), false),
    ).not.toThrow();
    expect(getNode).not.toHaveBeenCalled();
  });
});
