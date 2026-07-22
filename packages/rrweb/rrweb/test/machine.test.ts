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
