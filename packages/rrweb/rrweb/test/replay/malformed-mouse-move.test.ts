/**
 * @vitest-environment jsdom
 */
import { Replayer } from '../../src/replay';
import { addDelay } from '../../src/replay/timer';
import {
  EventType,
  IncrementalSource,
  ReplayerEvents,
  eventWithTime,
  incrementalSnapshotEvent,
} from '@posthog/rrweb-types';

const event = (timestamp = 1): eventWithTime => ({
  timestamp,
  type: EventType.DomContentLoaded,
  data: {},
});

const mouseMove = (
  positions: unknown,
  timestamp = 1,
): incrementalSnapshotEvent & { timestamp: number; delay?: number } =>
  ({
    timestamp,
    delay: 0,
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.MouseMove, positions },
  } as unknown as incrementalSnapshotEvent & {
    timestamp: number;
    delay?: number;
  });

// shapes a recording has been seen to carry in place of a positions array
const malformedPositions: [string, unknown][] = [
  ['a non-array with a length', 'nonsense'],
  ['an array-like with no first entry', { length: 3 }],
  ['null', null],
  ['an entry without a timeOffset', [{ x: 1, y: 2, id: 3 }]],
];

describe('malformed mouse move positions', () => {
  let replayer: Replayer;

  beforeEach(() => {
    // Replayer needs at least 2 events.
    replayer = new Replayer([event(), event()]);
  });

  const apply = (positions: unknown, isSync: boolean): void =>
    (
      replayer as unknown as {
        applyIncremental: (
          e: incrementalSnapshotEvent & { timestamp: number },
          isSync: boolean,
        ) => void;
      }
    ).applyIncremental(mouseMove(positions), isSync);

  it.each([
    ['a non-array', 'nonsense'],
    ['an empty array', []],
  ])('skips the event when positions is %s', (_name, positions) => {
    expect(() => apply(positions, false)).not.toThrow();
    expect(() => apply(positions, true)).not.toThrow();
  });

  it('still moves the cursor for well-formed positions', () => {
    apply([{ x: 1, y: 2, id: 3, timeOffset: 0 }], true);

    expect(
      (replayer as unknown as { mousePos: { x: number; y: number } }).mousePos,
    ).toMatchObject({ x: 1, y: 2, id: 3 });
  });
});

describe('addDelay with malformed positions', () => {
  it.each(malformedPositions)(
    'falls back to the event timestamp when positions is %s',
    (_name, positions) => {
      const e = mouseMove(positions, 1010);

      // a NaN delay never satisfies the timer, so playback would stall here
      expect(addDelay(e, 1000)).toBe(10);
      expect(e.delay).toBe(10);
    },
  );

  it('uses the first position offset for a well-formed batch', () => {
    const e = mouseMove([{ x: 1, y: 2, id: 3, timeOffset: -5 }], 1010);

    expect(addDelay(e, 1000)).toBe(5);
    expect(e.delay).toBe(5);
  });
});

describe('playing a recording with malformed mouse move positions', () => {
  let replayer: Replayer | undefined;

  afterEach(() => {
    replayer?.destroy();
    replayer = undefined;
  });

  it.each(malformedPositions)(
    'casts every later event and finishes when positions is %s',
    async (_name, positions) => {
      const events: eventWithTime[] = [
        event(1000),
        mouseMove(positions, 1010) as eventWithTime,
        event(1020),
        // last event: the finish buffer reads positions again
        mouseMove(positions, 1030) as eventWithTime,
      ];
      replayer = new Replayer(events);
      const cast: eventWithTime[] = [];
      replayer.on(ReplayerEvents.EventCast, (e) =>
        cast.push(e as eventWithTime),
      );
      const finished = new Promise<boolean>((resolve) => {
        replayer!.on(ReplayerEvents.Finish, () => resolve(true));
        setTimeout(() => resolve(false), 2000);
      });

      expect(() => replayer!.play()).not.toThrow();

      await expect(finished).resolves.toBe(true);
      expect(cast).toEqual(events);
    },
  );
});
