/**
 * @vitest-environment jsdom
 */
import { Replayer } from '../../src/replay';
import {
  EventType,
  IncrementalSource,
  eventWithTime,
  incrementalSnapshotEvent,
} from '@posthog/rrweb-types';

const event = (): eventWithTime => ({
  timestamp: 1,
  type: EventType.DomContentLoaded,
  data: {},
});

const mouseMove = (
  positions: unknown,
): incrementalSnapshotEvent & { timestamp: number; delay?: number } =>
  ({
    timestamp: 1,
    delay: 0,
    type: EventType.IncrementalSnapshot,
    data: { source: IncrementalSource.MouseMove, positions },
  } as unknown as incrementalSnapshotEvent & {
    timestamp: number;
    delay?: number;
  });

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
