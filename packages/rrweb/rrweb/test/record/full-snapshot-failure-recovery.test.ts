/**
 * @vitest-environment jsdom
 *
 * A failed full snapshot must never leave a half-started recorder: one that
 * is attached (record() handed back its stop closure, so the SDK's only
 * failure check `!this._stopRrweb` can never trip) but will never emit a
 * FullSnapshot. Every failure here must either recover on its own path
 * (observers installed, next snapshot lands) or surface as a throw the SDK
 * can catch and retry. The wire must also never carry an orphan Meta, i.e. a
 * Meta with no FullSnapshot behind it, on paths where the failure is known
 * before Meta goes out (the buffer-lock conflict).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventType, type eventWithTime } from '@posthog/rrweb-types';

const snapshotControl = vi.hoisted(() => ({
  failNextSnapshot: false,
  rejectNextWalkWithWatchdog: false,
}));

vi.mock('@posthog/rrweb-snapshot', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@posthog/rrweb-snapshot')>();
  return {
    ...actual,
    // a null return is how snapshot() reports "could not serialize the
    // document"; reachable in production but not injectable via options
    snapshot: (...args: Parameters<typeof actual.snapshot>) => {
      if (snapshotControl.failNextSnapshot) {
        snapshotControl.failNextSnapshot = false;
        return null;
      }
      return actual.snapshot(...args);
    },
    // the watchdog needs MAX_WALK_WALL_CLOCK_MS (30s) of stalled wall clock,
    // so its rejection is injected rather than waited for
    snapshotWithBudget: (
      ...args: Parameters<typeof actual.snapshotWithBudget>
    ) => {
      if (snapshotControl.rejectNextWalkWithWatchdog) {
        snapshotControl.rejectNextWalkWithWatchdog = false;
        return Promise.reject(
          new Error('Budgeted full snapshot exceeded its wall-clock limit'),
        );
      }
      return actual.snapshotWithBudget(...args);
    },
  };
});

import record from '../../src/record';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('full snapshot failure recovery', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    stop?.();
    stop = undefined;
    snapshotControl.failNextSnapshot = false;
    snapshotControl.rejectNextWalkWithWatchdog = false;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('a null initial snapshot on the synchronous path still installs observers and recovers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: eventWithTime[] = [];
    snapshotControl.failNextSnapshot = true;
    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
    });

    // the failure is visible and nothing pretends a snapshot landed
    expect(stop).toBeTypeOf('function');
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes('Failed to snapshot the document'),
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);

    // the recorder is running, not half-started: custom events are accepted
    expect(() =>
      record.addCustomEvent('after-null-snapshot', {}),
    ).not.toThrow();
    expect(
      events.some(
        (e) =>
          e.type === EventType.Custom &&
          (e as { data: { tag: string } }).data.tag === 'after-null-snapshot',
      ),
    ).toBe(true);

    // the next snapshot (the SDK's periodic/checkout path) recovers outright
    record.takeFullSnapshot();
    expect(
      events.filter((e) => e.type === EventType.FullSnapshot).length,
    ).toBe(1);

    // and observers really were installed: mutations flow against the
    // recovered mirror (settle first so the snapshot's own iframe-attach
    // cascade is not batched together with the marker's mutation)
    await settle();
    const marker = document.createElement('div');
    marker.id = 'observed-after-recovery';
    document.body.appendChild(marker);
    await vi.waitFor(() => {
      expect(
        events.some((e) =>
          JSON.stringify(e).includes('observed-after-recovery'),
        ),
      ).toBe(true);
    });
  });

  it('a reentrant snapshot that cannot take the buffer lock emits no orphan Meta', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: eventWithTime[] = [];
    let armReentry = false;
    let reentered = false;
    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
        if ((event as eventWithTime).type !== EventType.FullSnapshot) {
          return;
        }
        if (armReentry && !reentered) {
          reentered = true;
          // Runs while the outer synchronous snapshot still holds the
          // mutation buffer lock (its commit has not run yet), the same lock
          // window a checkout requested from inside a buffer commit hits.
          record.takeFullSnapshot();
        }
      },
    });

    armReentry = true;
    record.takeFullSnapshot();

    expect(reentered).toBe(true);
    const metas = events.filter((e) => e.type === EventType.Meta).length;
    const fulls = events.filter((e) => e.type === EventType.FullSnapshot).length;
    // init + explicit snapshot; the reentrant call must not add a Meta it
    // can never follow up with a FullSnapshot
    expect(fulls).toBe(2);
    expect(metas).toBe(2);
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes(
          'A different full snapshot owns the mutation buffers',
        ),
      ),
    ).toBe(true);
  });

  it('a watchdog rejection unwinds the walk with a diagnostic and recovers via the retry', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: eventWithTime[] = [];
    snapshotControl.rejectNextWalkWithWatchdog = true;
    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 25,
    });

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );

    const retryDiagnostics = events
      .filter((e) => e.type === EventType.Custom)
      .map(
        (e) =>
          (
            e as {
              data: { tag: string; payload?: { status?: string; reason?: string } };
            }
          ).data,
      )
      .filter((d) => d.tag === 'budgeted-full-snapshot')
      .map((d) => d.payload);
    const retry = retryDiagnostics.find((p) => p?.status === 'budgeted-retry');
    expect(retry).toBeDefined();
    expect(retry?.reason).toBe('watchdog-timeout');
    expect(
      events.filter((e) => e.type === EventType.FullSnapshot).length,
    ).toBe(1);
  }, 15_000);

  it('falls back to a synchronous snapshot when the consumer emit throws on the retry Meta', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const events: eventWithTime[] = [];
    let failNextMeta = false;
    stop = record({
      emit: (event) => {
        const e = event as eventWithTime;
        if (failNextMeta && e.type === EventType.Meta) {
          failNextMeta = false;
          throw new Error('injected consumer Meta failure');
        }
        events.push(e);
      },
      fullSnapshotYieldBudgetMs: 25,
    });

    // Overflow the held-event queue while the walk is in flight so it fails
    // with a retryable reason, then make the consumer's emit throw at the
    // retry's Meta. The recovery must land in the synchronous fallback, not
    // in a live recorder that never emits a FullSnapshot.
    for (let i = 0; i < 4200; i++) {
      record.addCustomEvent('queue-pressure', { index: i });
    }
    failNextMeta = true;

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );

    const statuses = events
      .filter((e) => e.type === EventType.Custom)
      .map((e) => (e as { data: { tag: string; payload?: { status?: string } } }).data)
      .filter((d) => d.tag === 'budgeted-full-snapshot')
      .map((d) => d.payload?.status);
    expect(statuses).toContain('budgeted-retry');
    expect(statuses).toContain('sync-fallback');
    expect(
      events.filter((e) => e.type === EventType.FullSnapshot).length,
    ).toBe(1);

    // recording is still live after the recovery
    expect(() => record.addCustomEvent('still-alive', {})).not.toThrow();
    expect(
      events.some(
        (e) =>
          e.type === EventType.Custom &&
          (e as { data: { tag: string } }).data.tag === 'still-alive',
      ),
    ).toBe(true);
  }, 15_000);
});
