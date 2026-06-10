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
        applyEventsSynchronously: vi.fn(),
        emitter: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } as any,
      },
    );
    service.start();
    return { service, getCastFn };
  };

  it('does not apply a past event onto the current DOM by default', () => {
    // a block of events loading after the user seeked ahead must not be
    // cast onto the current DOM — that DOM is at a different position, so
    // the mutations would target nodes that don't exist there
    const { service, getCastFn } = createService();
    const event = makeMutationEvent(BASELINE - 5000);

    service.send({ type: 'ADD_EVENT', payload: { event } });

    expect(getCastFn).not.toHaveBeenCalled();
    expect(service.state.context.events).toEqual([event]);
  });

  it('applies a past event synchronously when explicitly allowed (live mode)', () => {
    const castFn = vi.fn();
    const { service, getCastFn } = createService();
    getCastFn.mockReturnValue(castFn);
    const event = makeMutationEvent(BASELINE - 5000);

    service.send({
      type: 'ADD_EVENT',
      payload: { event, applyPastEventSynchronously: true },
    });

    expect(getCastFn).toHaveBeenCalledWith(event, true);
    expect(castFn).toHaveBeenCalled();
    expect(service.state.context.events).toEqual([event]);
  });

  it('inserts a future event without applying it while the timer is inactive', () => {
    const { service, getCastFn } = createService();
    const event = makeMutationEvent(BASELINE + 5000);

    service.send({ type: 'ADD_EVENT', payload: { event } });

    expect(getCastFn).not.toHaveBeenCalled();
    expect(service.state.context.events).toEqual([event]);
  });
});
