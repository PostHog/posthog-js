/**
 * @vitest-environment jsdom
 *
 * `fullSnapshotYieldBudgetMs` accepts only a finite positive number. The
 * coercions JavaScript would otherwise apply are both dangerous: `true`
 * becomes a 1ms budget (a minutes-long walk on a large page) and `Infinity` a
 * walk that never yields — so anything else must mean "off", falling back to
 * the synchronous snapshot, with a warning.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import record from '../../src/record';
import { EventType, type eventWithTime } from '@posthog/rrweb-types';

describe('fullSnapshotYieldBudgetMs validation', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.restoreAllMocks();
  });

  it.each([
    ['true', true],
    ['Infinity', Infinity],
    ['NaN', NaN],
    ['a negative number', -5],
    ['a string', '25'],
  ])(
    'falls back to the synchronous path when given %s',
    (_label, value) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const events: eventWithTime[] = [];
      stop = record({
        emit: (event) => {
          events.push(event as eventWithTime);
        },
        fullSnapshotYieldBudgetMs: value as unknown as number,
      });

      // synchronous means the FullSnapshot is on the wire before record()
      // returns — no walk was started
      expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(true);
      expect(
        warn.mock.calls.some((args) =>
          String(args[0]).includes('fullSnapshotYieldBudgetMs'),
        ),
      ).toBe(true);
    },
  );

  it('accepts a real budget without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: eventWithTime[] = [];
    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 25,
    });

    // budgeted means the FullSnapshot is NOT synchronous
    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes('fullSnapshotYieldBudgetMs'),
      ),
    ).toBe(false);
  });

  it('leaves the default (0) silent and synchronous', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: eventWithTime[] = [];
    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(true);
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes('fullSnapshotYieldBudgetMs'),
      ),
    ).toBe(false);
  });
});
