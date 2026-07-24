import { applyEventsWithYield } from '../src/replay/fast-forward';
import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

const makeEvents = (count: number): eventWithTime[] =>
  Array.from(
    { length: count },
    (_, i): eventWithTime => ({
      type: EventType.IncrementalSnapshot,
      data: {
        source: IncrementalSource.Mutation,
        texts: [],
        attributes: [],
        removes: [],
        adds: [],
      },
      timestamp: 1_000_000 + i,
    }),
  );

describe('applyEventsWithYield', () => {
  const setup = (
    events: eventWithTime[],
    options: {
      yieldBudgetMs?: number;
      // ms the fake clock advances each time an event is applied
      msPerEvent?: number;
      cancelled?: () => boolean;
    } = {},
  ) => {
    let clock = 0;
    const applied: eventWithTime[] = [];
    const scheduled: Array<() => void> = [];
    const onComplete = vi.fn();
    applyEventsWithYield({
      events,
      castEvent: (event) => {
        clock += options.msPerEvent ?? 0;
        applied.push(event);
      },
      yieldBudgetMs: options.yieldBudgetMs ?? 0,
      schedule: (fn) => scheduled.push(fn),
      isCancelled: options.cancelled ?? (() => false),
      onComplete,
      now: () => clock,
    });
    // runs the next pending continuation, as the event loop would
    const runNextContinuation = () => {
      const fn = scheduled.shift();
      expect(fn).toBeDefined();
      fn!();
    };
    return { applied, scheduled, onComplete, runNextContinuation };
  };

  it('applies everything synchronously when the budget is 0', () => {
    const events = makeEvents(50);
    const { applied, scheduled, onComplete } = setup(events, {
      yieldBudgetMs: 0,
      msPerEvent: 100, // would blow any budget if one applied
    });

    expect(applied).toEqual(events);
    expect(scheduled).toHaveLength(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it('applies everything synchronously when work fits within one budget', () => {
    const events = makeEvents(50);
    const { applied, scheduled, onComplete } = setup(events, {
      yieldBudgetMs: 10,
      msPerEvent: 0,
    });

    expect(applied).toEqual(events);
    expect(scheduled).toHaveLength(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it('yields once the budget is exhausted and finishes over multiple chunks', () => {
    const events = makeEvents(10);
    // budget 3ms at 1ms/event: 3 events per chunk
    const { applied, onComplete, runNextContinuation } = setup(events, {
      yieldBudgetMs: 3,
      msPerEvent: 1,
    });

    expect(applied).toHaveLength(3);
    expect(onComplete).not.toHaveBeenCalled();

    runNextContinuation();
    expect(applied).toHaveLength(6);
    runNextContinuation();
    expect(applied).toHaveLength(9);
    expect(onComplete).not.toHaveBeenCalled();

    runNextContinuation();
    expect(applied).toEqual(events);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(false);
  });

  it('always applies at least one event per chunk', () => {
    const events = makeEvents(3);
    // every single event exceeds the budget on its own
    const { applied, onComplete, runNextContinuation } = setup(events, {
      yieldBudgetMs: 1,
      msPerEvent: 50,
    });

    expect(applied).toHaveLength(1);
    runNextContinuation();
    expect(applied).toHaveLength(2);
    runNextContinuation();
    expect(applied).toEqual(events);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(false);
  });

  it('stops without completing when cancelled between chunks', () => {
    const events = makeEvents(10);
    let cancelled = false;
    const { applied, scheduled, onComplete, runNextContinuation } = setup(
      events,
      {
        yieldBudgetMs: 3,
        msPerEvent: 1,
        cancelled: () => cancelled,
      },
    );

    expect(applied).toHaveLength(3);
    cancelled = true;
    runNextContinuation();

    expect(applied).toHaveLength(3);
    expect(scheduled).toHaveLength(0);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
