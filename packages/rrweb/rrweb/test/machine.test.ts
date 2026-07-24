import {
  createPlayerService,
  discardPriorSnapshots,
} from '../src/replay/machine';
import { Timer } from '../src/replay/timer';
import { sampleEvents } from './utils';
import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';

const events = sampleEvents.filter(
  (e) => ![EventType.DomContentLoaded, EventType.Load].includes(e.type),
);
const nextEvents = events.map((e) => ({
  ...e,
  timestamp: e.timestamp + 1000,
}));
const nextNextEvents = nextEvents.map((e) => ({
  ...e,
  timestamp: e.timestamp + 1000,
}));

const makeMutationEvent = (timestamp: number): eventWithTime => ({
  type: EventType.IncrementalSnapshot,
  data: {
    source: IncrementalSource.Mutation,
    texts: [],
    attributes: [],
    removes: [{ parentId: 1, id: 2 }],
    adds: [],
  },
  timestamp,
});

describe('get last session', () => {
  it('will return all the events when there is only one session', () => {
    expect(discardPriorSnapshots(events, events[0].timestamp)).toEqual(events);
  });

  it('will return last session when there is more than one in the events', () => {
    const multiple = events.concat(nextEvents).concat(nextNextEvents);
    expect(
      discardPriorSnapshots(
        multiple,
        nextNextEvents[nextNextEvents.length - 1].timestamp,
      ),
    ).toEqual(nextNextEvents);
  });

  it('will return last session when baseline time is future time', () => {
    const multiple = events.concat(nextEvents).concat(nextNextEvents);
    expect(
      discardPriorSnapshots(
        multiple,
        nextNextEvents[nextNextEvents.length - 1].timestamp + 1000,
      ),
    ).toEqual(nextNextEvents);
  });

  it('will return all sessions when baseline time is prior time', () => {
    expect(discardPriorSnapshots(events, events[0].timestamp - 1000)).toEqual(
      events,
    );
  });
});

describe('addEvent', () => {
  const BASELINE = 1_000_000;

  const createService = () => {
    const getCastFn = vi.fn(() => vi.fn());
    const service = createPlayerService(
      {
        events: [],
        timer: new Timer([], { speed: 1 }),
        timeOffset: 0,
        baselineTime: BASELINE,
        lastPlayedEvent: null,
      },
      {
        getCastFn,
        applyEvents: vi.fn(),
        emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as any,
      },
    );
    service.start();
    return { service, getCastFn };
  };

  it.each([
    { label: 'absent', applyPastEventSynchronously: undefined },
    { label: 'false', applyPastEventSynchronously: false },
  ])(
    'does not apply a past event onto the current DOM when applyPastEventSynchronously is $label',
    ({ applyPastEventSynchronously }) => {
      // a chunk loading after the user seeked ahead must not be cast onto a
      // DOM that is at a different position
      const { service, getCastFn } = createService();
      const event = makeMutationEvent(BASELINE - 5000);

      service.send({
        type: 'ADD_EVENT',
        payload: { event, applyPastEventSynchronously },
      });

      expect(getCastFn).not.toHaveBeenCalled();
      expect(service.state.context.events).toEqual([event]);
    },
  );

  it('applies a past event synchronously when explicitly allowed (live mode)', () => {
    const { service, getCastFn } = createService();
    const event = makeMutationEvent(BASELINE - 5000);

    service.send({
      type: 'ADD_EVENT',
      payload: { event, applyPastEventSynchronously: true },
    });

    expect(getCastFn).toHaveBeenCalledWith(event, true);
    expect(getCastFn.mock.results[0].value).toHaveBeenCalled();
    expect(service.state.context.events).toEqual([event]);
  });

  it('inserts a future event without applying it while the timer is inactive', () => {
    const { service, getCastFn } = createService();
    const event = makeMutationEvent(BASELINE + 5000);

    service.send({ type: 'ADD_EVENT', payload: { event } });

    expect(getCastFn).not.toHaveBeenCalled();
    expect(service.state.context.events).toEqual([event]);
  });

  it('RESET_LAST_PLAYED clears lastPlayedEvent without changing state', () => {
    const { service } = createService();
    const event = makeMutationEvent(BASELINE + 1);
    service.send({ type: 'CAST_EVENT', payload: { event } });
    expect(service.state.context.lastPlayedEvent).toBe(event);

    service.send({ type: 'RESET_LAST_PLAYED' });

    expect(service.state.context.lastPlayedEvent).toBeNull();
    expect(service.state.value).toEqual('paused');
  });
});

describe('play scheduling', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createPlayingService = (initialEvents: eventWithTime[]) => {
    const timer = new Timer([], { speed: 1 });
    let onApplied: (() => void) | undefined;
    const applyEvents = vi.fn(
      (_events: eventWithTime[], done: () => void) => {
        onApplied = done;
      },
    );
    const getCastFn = vi.fn(() => vi.fn());
    const service = createPlayerService(
      {
        events: initialEvents,
        timer,
        timeOffset: 0,
        baselineTime: 0,
        lastPlayedEvent: null,
      },
      {
        getCastFn,
        applyEvents,
        emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as any,
      },
    );
    service.start();
    return {
      service,
      timer,
      applyEvents,
      completeRebuild: () => onApplied!(),
    };
  };

  const actionCount = (timer: Timer): number =>
    (timer as unknown as { actions: unknown[] }).actions.length;

  it('schedules future events only once the rebuild completes, including events added while it was in flight', () => {
    const e1 = makeMutationEvent(1000);
    const e2 = makeMutationEvent(2000);
    const { service, timer, completeRebuild } = createPlayingService([e1, e2]);

    service.send({ type: 'PLAY', payload: { timeOffset: 500 } }); // baseline 1500

    // rebuild in flight: nothing on the timer yet
    expect(actionCount(timer)).toBe(0);

    const addedMidRebuild = makeMutationEvent(1800);
    service.send({ type: 'ADD_EVENT', payload: { event: addedMidRebuild } });
    expect(actionCount(timer)).toBe(0);

    completeRebuild();

    // e2 and the mid-rebuild event are both scheduled; e1 was a sync event
    expect(actionCount(timer)).toBe(2);
    expect(timer.isActive()).toBe(true);
  });

  it('a forward seek after a completed rebuild only fast-forwards the delta', () => {
    const e1 = makeMutationEvent(1000);
    const e2 = makeMutationEvent(2000);
    const e3 = makeMutationEvent(3000);
    const { service, applyEvents, completeRebuild } = createPlayingService([
      e1,
      e2,
      e3,
    ]);

    service.send({ type: 'PLAY', payload: { timeOffset: 1500 } }); // baseline 2500
    expect(applyEvents.mock.calls[0][0]).toEqual([e1, e2]);
    completeRebuild();
    // the replayer sends CAST_EVENT per applied event; simulate the last one
    service.send({ type: 'CAST_EVENT', payload: { event: e2 } });
    service.send({ type: 'PAUSE' });

    service.send({ type: 'PLAY', payload: { timeOffset: 2500 } }); // baseline 3500
    expect(applyEvents.mock.calls[1][0]).toEqual([e3]);
  });

  it('RESET_LAST_PLAYED forces the next seek to fast-forward the full history', () => {
    const e1 = makeMutationEvent(1000);
    const e2 = makeMutationEvent(2000);
    const e3 = makeMutationEvent(3000);
    const { service, applyEvents, completeRebuild } = createPlayingService([
      e1,
      e2,
      e3,
    ]);

    service.send({ type: 'PLAY', payload: { timeOffset: 1500 } });
    completeRebuild();
    service.send({ type: 'CAST_EVENT', payload: { event: e2 } });
    service.send({ type: 'PAUSE' });

    service.send({ type: 'RESET_LAST_PLAYED' });
    service.send({ type: 'PLAY', payload: { timeOffset: 2500 } }); // baseline 3500
    expect(applyEvents.mock.calls[1][0]).toEqual([e1, e2, e3]);
  });
});
