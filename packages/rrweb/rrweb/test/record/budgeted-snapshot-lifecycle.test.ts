/**
 * @vitest-environment jsdom
 *
 * Lifecycle hardening around the time-sliced full snapshot: a failed record()
 * must not leave the shared mirror in reservation mode, a throwing iframe
 * reattach must not cost a delivered snapshot its held window or its
 * post-snapshot steps, freezePage() during a walk must defer the commit to
 * unfreeze() and say so on the wire, and the held-event scrub must filter
 * selection ranges individually instead of dropping mixed selections whole.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventType, IncrementalSource } from '@posthog/rrweb-types';
import type { eventWithTime, eventWithoutTime } from '@posthog/rrweb-types';

const observeControl = vi.hoisted(() => ({ failNextInitObservers: false }));

vi.mock('../../src/record/observer', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/record/observer')>();
  return {
    ...actual,
    initObservers: (...args: Parameters<typeof actual.initObservers>) => {
      if (observeControl.failNextInitObservers) {
        observeControl.failNextInitObservers = false;
        throw new Error('injected initObservers failure');
      }
      return actual.initObservers(...args);
    },
  };
});

import record, { scrubUnclaimedIds } from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';
import { IframeManager } from '../../src/record/iframe-manager';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// enough nodes that a 1ms yield budget makes the walk span several tasks,
// so the assertions below reliably land while it is in flight
function fillBody(count = 2000) {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div');
    div.textContent = `node-${i}`;
    fragment.appendChild(div);
  }
  document.body.appendChild(fragment);
}

function diagnostics(events: eventWithTime[]) {
  return events
    .filter((e) => e.type === EventType.Custom)
    .map(
      (e) =>
        (
          e as {
            data: { tag: string; payload?: Record<string, unknown> };
          }
        ).data,
    )
    .filter((d) => d.tag === 'budgeted-full-snapshot')
    .map((d) => d.payload);
}

describe('budgeted snapshot lifecycle hardening', () => {
  let stop: (() => void) | undefined;

  afterEach(async () => {
    stop?.();
    stop = undefined;
    observeControl.failNextInitObservers = false;
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    // let any abandoned walk settle and release its buffer transaction
    await settle();
  });

  it('a throwing observe(document) does not leave the mirror in reservation mode', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    observeControl.failNextInitObservers = true;

    const result = record({
      emit: () => {},
      fullSnapshotYieldBudgetMs: 1,
    });

    // the failure surfaced the pre-budget way: no stop closure handed back
    expect(result).toBeUndefined();

    // the reservation the walk opened must be over: a connected node the
    // dead walk never serialized reads as -1, not as a fresh reserved id
    const orphan = document.createElement('div');
    document.body.appendChild(orphan);
    expect(record.mirror.getId(orphan)).toBe(-1);
  });

  it('a throwing iframe reattach on the synchronous path does not kill record()', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(IframeManager.prototype, 'reattachIframes').mockImplementation(
      () => {
        throw new Error('injected reattach failure');
      },
    );
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      recordCrossOriginIframes: true,
    });

    // the snapshot was delivered, so the failure must not unwind record()
    expect(stop).toBeTypeOf('function');
    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(true);
    expect(
      warn.mock.calls.some((args) =>
        String(args[0]).includes('Iframe reattach failed'),
      ),
    ).toBe(true);
  });

  it('a throwing iframe reattach mid-flush still delivers the held window', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(IframeManager.prototype, 'reattachIframes').mockImplementation(
      () => {
        throw new Error('injected reattach failure');
      },
    );
    fillBody();
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      recordCrossOriginIframes: true,
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    record.addCustomEvent('held-during-walk', {});

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );

    // the held event survived the reattach failure
    const fullIndex = events.findIndex(
      (e) => e.type === EventType.FullSnapshot,
    );
    const heldIndex = events.findIndex(
      (e) =>
        e.type === EventType.Custom &&
        (e as { data: { tag: string } }).data.tag === 'held-during-walk',
    );
    expect(heldIndex).toBeGreaterThan(fullIndex);

    // and the transaction was released: the next snapshot goes out
    record.takeFullSnapshot();
    await vi.waitFor(
      () => {
        expect(
          events.filter((e) => e.type === EventType.FullSnapshot).length,
        ).toBe(2);
      },
      { timeout: 10_000 },
    );
  }, 20_000);

  it('freezePage during a walk defers the commit to unfreeze and reports it', async () => {
    fillBody();
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    const marker = document.createElement('div');
    marker.id = 'deferred-marker';
    document.body.appendChild(marker);
    record.freezePage();

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );

    // the frozen buffer's records were reported as deferred, not silently
    // claimed as committed
    const incomplete = diagnostics(events).find(
      (p) => p?.status === 'mutation-commit-incomplete',
    );
    expect(incomplete).toBeDefined();
    expect(incomplete?.deferredMutationRecords as number).toBeGreaterThan(0);
    expect(incomplete?.droppedMutationRecords).toBe(0);

    // nothing about the marker went out while frozen
    expect(JSON.stringify(events)).not.toContain('deferred-marker');

    // unfreeze delivers the deferred records against the committed mirror
    mutationBuffers.forEach((buffer) => buffer.unfreeze());
    await vi.waitFor(() => {
      const mutations = events.filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          (e as { data: { source: IncrementalSource } }).data.source ===
            IncrementalSource.Mutation,
      );
      expect(JSON.stringify(mutations)).toContain('deferred-marker');
    });
  }, 20_000);

  describe('scrubUnclaimedIds selection handling', () => {
    const selectionEvent = (
      ranges: Array<{ start: number; end: number }>,
    ): eventWithoutTime =>
      ({
        type: EventType.IncrementalSnapshot,
        data: {
          source: IncrementalSource.Selection,
          ranges: ranges.map((r) => ({
            start: r.start,
            startOffset: 0,
            end: r.end,
            endOffset: 1,
          })),
        },
      }) as unknown as eventWithoutTime;

    it('filters dead ranges individually instead of dropping the selection', () => {
      const event = selectionEvent([
        { start: 1, end: 2 },
        { start: 99, end: 2 },
      ]);
      const scrubbed = scrubUnclaimedIds(event, new Set([99]));
      expect(scrubbed).not.toBeNull();
      expect(scrubbed).not.toBe(event);
      const ranges = (scrubbed as { data: { ranges: unknown[] } }).data.ranges;
      expect(ranges).toHaveLength(1);
      expect(ranges[0]).toMatchObject({ start: 1, end: 2 });
      // the original held event is untouched
      expect(
        (event as unknown as { data: { ranges: unknown[] } }).data.ranges,
      ).toHaveLength(2);
    });

    it('drops the event only when every range is dead', () => {
      const event = selectionEvent([
        { start: 99, end: 100 },
        { start: 100, end: 99 },
      ]);
      expect(scrubUnclaimedIds(event, new Set([99, 100]))).toBeNull();
    });

    it('keeps a fully valid selection by reference', () => {
      const event = selectionEvent([{ start: 1, end: 2 }]);
      expect(scrubUnclaimedIds(event, new Set([99]))).toBe(event);
    });

    it('keeps an empty-ranges selection (deselection) untouched', () => {
      const event = selectionEvent([]);
      expect(scrubUnclaimedIds(event, new Set([99]))).toBe(event);
    });
  });
});
