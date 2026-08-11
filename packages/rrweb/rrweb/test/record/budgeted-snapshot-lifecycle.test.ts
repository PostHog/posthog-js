/**
 * @vitest-environment jsdom
 *
 * Lifecycle hardening around the time-sliced full snapshot: a failed record()
 * must not leave the shared mirror in reservation mode, a throwing iframe
 * reattach must not cost a delivered snapshot its held window or its
 * post-snapshot steps, freezePage() during a walk must defer the commit to
 * unfreeze() and say so on the wire, and the held-event scrub must filter
 * selection ranges individually instead of dropping mixed selections whole.
 * Also covered: reservations stay answerable through the flush and are
 * claimed by the commit, held caller-owned payloads are snapshotted at hold
 * time, order-independent SDK control events bypass the held window, only the
 * fullscreen custom event is scrubbed by payload id, and isIgnored never
 * mints a reservation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  EventType,
  FullscreenCustomEventTag,
  IncrementalSource,
} from '@posthog/rrweb-types';
import type { eventWithTime, eventWithoutTime } from '@posthog/rrweb-types';
import { createMirror, slimDOMDefaults } from '@posthog/rrweb-snapshot';

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

import record, {
  estimateRetainedSize,
  scrubUnclaimedIds,
} from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';
import { IframeManager } from '../../src/record/iframe-manager';
import { isIgnored } from '../../src/utils';

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

  it('a reservation minted mid-walk stays answerable during the flush and is claimed by the commit', async () => {
    fillBody();
    const events: eventWithTime[] = [];
    let marker: HTMLElement | null = null;
    let flushProbeId: number | null = null;

    stop = record({
      emit: (event) => {
        const e = event as eventWithTime;
        events.push(e);
        if (
          marker &&
          e.type === EventType.Custom &&
          (e as { data: { tag: string } }).data.tag === 'held-during-walk'
        ) {
          // this delivery happens inside the flush, after the handout pause
          // and before the buffer commit; the reserved id must still answer
          flushProbeId = record.mirror.getId(marker);
        }
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);

    // created mid-walk: the walk skips it (its add is pending in the locked
    // buffer) and the commit re-serializes it
    marker = document.createElement('div');
    marker.id = 'reserved-marker';
    document.body.appendChild(marker);
    // an observer resolving the node mid-walk mints its reservation
    const reservedId = record.mirror.getId(marker);
    expect(reservedId).toBeGreaterThan(0);
    // a held event so the flush re-enters the consumer while paused
    record.addCustomEvent('held-during-walk', {});

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );
    await settle();

    expect(flushProbeId).toBe(reservedId);
    // the commit claimed exactly the reserved id for the marker's add
    expect(record.mirror.getId(marker)).toBe(reservedId);
    const adds = events
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          (e as { data: { source: IncrementalSource } }).data.source ===
            IncrementalSource.Mutation,
      )
      .flatMap(
        (e) =>
          (e as unknown as { data: { adds?: Array<{ node: { id: number } }> } })
            .data.adds ?? [],
      );
    expect(adds.some((a) => a.node.id === reservedId)).toBe(true);
  }, 20_000);

  it('a rotation from a mutation delivered during the commit leaves the new session gate intact', async () => {
    fillBody();
    const eventsA: eventWithTime[] = [];
    const eventsB: eventWithTime[] = [];
    let marker: HTMLElement | null = null;
    let rotated = false;
    let stopB: (() => void) | undefined;

    const carriesMarkerAdd = (e: eventWithTime) => {
      if (
        e.type !== EventType.IncrementalSnapshot ||
        (e as { data: { source: IncrementalSource } }).data.source !==
          IncrementalSource.Mutation
      ) {
        return false;
      }
      const adds =
        (e as unknown as { data: { adds?: Array<{ node: { id: number } }> } })
          .data.adds ?? [];
      return (
        marker !== null &&
        adds.some((a) => a.node.id === record.mirror.getId(marker as Node))
      );
    };

    stop = record({
      emit: (event) => {
        const e = event as eventWithTime;
        eventsA.push(e);
        if (!rotated && carriesMarkerAdd(e)) {
          rotated = true;
          // the exact reentry of F1's residual: the commit's own delivery
          // rotates the recorder. The old commit must not clear the lock
          // owner the new session arms right here.
          stop?.();
          stop = undefined;
          stopB = record({
            emit: (event2) => {
              eventsB.push(event2 as eventWithTime);
            },
            fullSnapshotYieldBudgetMs: 1,
          });
          // observed while B's walk is in flight: with the gate disarmed
          // this would emit against B's half-built mirror before B's
          // FullSnapshot; with it intact it is held for B's commit
          const midWalk = document.createElement('div');
          midWalk.id = 'mid-walk-after-rotation';
          document.body.appendChild(midWalk);
        }
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    // created mid-walk so its add is delivered from inside A's commit
    marker = document.createElement('div');
    marker.id = 'rotation-trigger';
    document.body.appendChild(marker);

    try {
      await vi.waitFor(
        () => {
          expect(rotated).toBe(true);
          expect(eventsB.some((e) => e.type === EventType.FullSnapshot)).toBe(
            true,
          );
        },
        { timeout: 10_000 },
      );
      await settle();

      const isMutation = (e: eventWithTime) =>
        e.type === EventType.IncrementalSnapshot &&
        (e as { data: { source: IncrementalSource } }).data.source ===
          IncrementalSource.Mutation;

      // nothing observed during B's walk may get ahead of B's FullSnapshot
      const bFullIdx = eventsB.findIndex(
        (e) => e.type === EventType.FullSnapshot,
      );
      expect(eventsB.slice(0, bFullIdx).filter(isMutation)).toHaveLength(0);

      // B's commit released its buffers: steady-state mutations still flow
      const late = document.createElement('div');
      late.id = 'post-rotation-steady-state';
      document.body.appendChild(late);
      await vi.waitFor(
        () => {
          const adds = eventsB
            .filter(isMutation)
            .flatMap(
              (e) =>
                (
                  e as unknown as {
                    data: { adds?: Array<{ node: { id: number } }> };
                  }
                ).data.adds ?? [],
            );
          expect(
            adds.some((a) => a.node.id === record.mirror.getId(late)),
          ).toBe(true);
        },
        { timeout: 10_000 },
      );
    } finally {
      stopB?.();
    }
  }, 30_000);

  it('a shadow-root scroll during a checkout walk is not lost to the re-arm window', async () => {
    // the host sits behind 2000 filler nodes, so a sliced checkout walk
    // reaches it late: a scroll dispatched at walk start lands squarely in
    // the window where init() has torn the root's scroll listener down
    fillBody();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    inner.textContent = 'scrollable shadow content';
    shadow.appendChild(inner);
    document.body.appendChild(host);

    const events: eventWithTime[] = [];
    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    await vi.waitFor(
      () => {
        expect(
          events.filter((e) => e.type === EventType.FullSnapshot),
        ).toHaveLength(1);
      },
      { timeout: 10_000 },
    );
    await settle();
    const innerId = record.mirror.getId(inner);
    expect(innerId).toBeGreaterThan(0);

    // checkout: init() disconnects every shadow observer at walk start
    record.takeFullSnapshot(true);
    expect(events.filter((e) => e.type === EventType.FullSnapshot)).toHaveLength(
      1,
    );
    // observed while the walk is in flight and the walker has not reached
    // the host yet; without the up-front re-arm nothing is listening
    inner.dispatchEvent(new Event('scroll', { bubbles: true }));

    await vi.waitFor(
      () => {
        expect(
          events.filter((e) => e.type === EventType.FullSnapshot),
        ).toHaveLength(2);
      },
      { timeout: 10_000 },
    );
    // the scroll observer throttles; give its trailing edge time to land
    await new Promise((resolve) => setTimeout(resolve, 250));

    const scrolls = events.filter(
      (e) =>
        e.type === EventType.IncrementalSnapshot &&
        (e as { data: { source: IncrementalSource } }).data.source ===
          IncrementalSource.Scroll &&
        (e as unknown as { data: { id: number } }).data.id === innerId,
    );
    expect(scrolls.length).toBeGreaterThan(0);
  }, 30_000);

  it('order-independent SDK control events bypass the held window', async () => {
    fillBody();
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    record.addCustomEvent('$session_id_change', {
      sessionId: 'next-session',
      windowId: 'next-window',
      changeReason: { activityTimeout: true },
    });
    record.addCustomEvent('ordinary-tag', {});

    const tagIndex = (tag: string) =>
      events.findIndex(
        (e) =>
          e.type === EventType.Custom &&
          (e as { data: { tag: string } }).data.tag === tag,
      );

    // the control event is already on the wire, before the walk finished
    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    expect(tagIndex('$session_id_change')).toBeGreaterThan(-1);
    // the ordinary custom event is held like anything else
    expect(tagIndex('ordinary-tag')).toBe(-1);

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );
    await settle();

    const fullIndex = events.findIndex(
      (e) => e.type === EventType.FullSnapshot,
    );
    expect(tagIndex('$session_id_change')).toBeLessThan(fullIndex);
    expect(tagIndex('ordinary-tag')).toBeGreaterThan(fullIndex);
  }, 20_000);

  it('a held custom payload records the value it had at hold time', async () => {
    fillBody();
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    const payload = { step: 'started', items: [1, 2] };
    record.addCustomEvent('checkout', payload);
    // the caller mutating its payload after the fact must not rewrite the
    // held event; the synchronous path would have serialized it already
    payload.step = 'mutated-after-hold';
    payload.items.push(3);

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );
    await settle();

    const recorded = events.find(
      (e) =>
        e.type === EventType.Custom &&
        (e as { data: { tag: string } }).data.tag === 'checkout',
    ) as unknown as { data: { payload: unknown } } | undefined;
    expect(recorded).toBeDefined();
    expect(recorded?.data.payload).toEqual({ step: 'started', items: [1, 2] });
  }, 20_000);

  it('an aborted walk drains dead nodes from the mirror instead of leaking them', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fillBody();
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    // serialized in the first slice, so its removal mid-walk goes through
    // mapRemoves rather than cancelling a pending add
    const victim = document.body.children[0] as HTMLElement;
    expect(record.mirror.getMeta(victim)).not.toBeNull();
    const victimId = record.mirror.getId(victim);
    expect(victimId).toBeGreaterThan(0);
    victim.remove();

    // overflow the held queue so the walk aborts and discards its buffers
    for (let i = 0; i < 4200; i++) {
      record.addCustomEvent('queue-pressure', { index: i });
    }

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 15_000 },
    );
    await settle();

    // the discard drained mapRemoves through the mirror like a commit does:
    // the dead node is no longer resolvable by id
    expect(record.mirror.getNode(victimId)).toBeNull();
  }, 20_000);

  it('held non-mutation events survive an abort and land after the retry snapshot', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fillBody();
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    // a click observed mid-walk on a node the first slice already serialized
    expect(record.mirror.getMeta(document.body)).not.toBeNull();
    document.body.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );

    // Bank enough mutation records in the locked buffer that the next abort
    // probe trips the backlog cap and the walk retries. Spread across many
    // small containers: jsdom's live NodeList makes one 50k-child parent
    // quadratic to traverse, which is a test-environment artifact.
    const fragment = document.createDocumentFragment();
    for (let c = 0; c < 510; c++) {
      const container = document.createElement('div');
      for (let i = 0; i < 100; i++) {
        container.appendChild(document.createElement('i'));
      }
      fragment.appendChild(container);
    }
    document.body.appendChild(fragment);

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 25_000 },
    );
    await settle();

    const retry = diagnostics(events).find(
      (p) => p?.status === 'budgeted-retry',
    );
    expect(retry).toBeDefined();
    expect(retry?.reason).toBe('mutation-backlog');
    expect(retry?.carriedHeldEventCount).toBe(1);

    // the retry that recovered reports its own success telemetry, and the
    // carry shows up there instead of vanishing into the failure report
    const completed = diagnostics(events).find(
      (p) => p?.status === 'completed',
    );
    expect(completed).toBeDefined();
    expect(completed?.isRetry).toBe(true);
    expect(completed?.carriedHeldEventCount).toBe(1);

    // the click was not lost to the abort: it went out after the retry's
    // FullSnapshot, where the id it references is valid again
    const fullIndex = events.findIndex(
      (e) => e.type === EventType.FullSnapshot,
    );
    const clickIndex = events.findIndex(
      (e) =>
        e.type === EventType.IncrementalSnapshot &&
        (e as { data: { source: IncrementalSource } }).data.source ===
          IncrementalSource.MouseInteraction,
    );
    expect(fullIndex).toBeGreaterThan(-1);
    expect(clickIndex).toBeGreaterThan(fullIndex);
    expect(
      events.filter((e) => e.type === EventType.FullSnapshot).length,
    ).toBe(1);

    // the carried click was observed before the retry walk started, so its
    // held timestamp predates the retry FullSnapshot's — without the clamp
    // the replayer's timestamp sort would put it BEFORE the snapshot that
    // introduces its target id and drop it
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(
        events[i - 1].timestamp,
      );
    }
  }, 30_000);

  it('a held delivery that keeps failing is retried once and counted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fillBody();
    const events: eventWithTime[] = [];
    let poisonAttempts = 0;

    stop = record({
      emit: (event) => {
        const e = event as eventWithTime;
        if (
          e.type === EventType.Custom &&
          (e as { data: { tag: string } }).data.tag === 'poison'
        ) {
          poisonAttempts++;
          throw new Error('injected consumer failure');
        }
        events.push(e);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    record.addCustomEvent('poison', {});
    record.addCustomEvent('kept', {});

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );
    await settle();

    // delivery was retried exactly once, and the rest of the window survived
    expect(poisonAttempts).toBe(2);
    expect(
      events.some(
        (e) =>
          e.type === EventType.Custom &&
          (e as { data: { tag: string } }).data.tag === 'kept',
      ),
    ).toBe(true);
    // the loss is visible on the wire, not silent
    const incomplete = diagnostics(events).find(
      (p) => p?.status === 'mutation-commit-incomplete',
    );
    expect(incomplete).toBeDefined();
    expect(incomplete?.failedHeldEventDeliveries).toBe(1);
  }, 20_000);

  it('a flaky consumer delivery is retried once and the event is not lost', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fillBody();
    const events: eventWithTime[] = [];
    let flakyAttempts = 0;

    stop = record({
      emit: (event) => {
        const e = event as eventWithTime;
        if (
          e.type === EventType.Custom &&
          (e as { data: { tag: string } }).data.tag === 'flaky' &&
          flakyAttempts++ === 0
        ) {
          throw new Error('injected transient consumer failure');
        }
        events.push(e);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    record.addCustomEvent('flaky', {});

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );
    await settle();

    expect(
      events.filter(
        (e) =>
          e.type === EventType.Custom &&
          (e as { data: { tag: string } }).data.tag === 'flaky',
      ).length,
    ).toBe(1);
    // a recovered delivery is not a loss: no degradation diagnostic
    expect(
      diagnostics(events).find(
        (p) => p?.status === 'mutation-commit-incomplete',
      ),
    ).toBeUndefined();
  }, 20_000);

  it('a recording whose first snapshot never lands does not checkout-storm', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fillBody();
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        const e = event as eventWithTime;
        events.push(e);
        // the consumer rejects every FullSnapshot: budgeted walk, retry and
        // synchronous fallback all fail to land one
        if (e.type === EventType.FullSnapshot) {
          throw new Error('injected consumer FullSnapshot failure');
        }
      },
      fullSnapshotYieldBudgetMs: 1,
      checkoutEveryNms: 1,
    });

    await vi.waitFor(
      () => {
        expect(
          diagnostics(events).some((p) => p?.status === 'sync-fallback-failed'),
        ).toBe(true);
      },
      { timeout: 10_000 },
    );
    await settle();

    const metasBefore = events.filter((e) => e.type === EventType.Meta).length;
    // every incremental is now long past checkoutEveryNms of a clock that
    // never started; none of them may re-trip a snapshot
    for (let i = 0; i < 5; i++) {
      document.body.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      await settle();
    }

    expect(
      events.some(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          (e as { data: { source: IncrementalSource } }).data.source ===
            IncrementalSource.MouseInteraction,
      ),
    ).toBe(true);
    expect(events.filter((e) => e.type === EventType.Meta).length).toBe(
      metasBefore,
    );
  }, 20_000);

  it('held-window replays do not count toward the checkoutEveryNth budget', async () => {
    fillBody();
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
      checkoutEveryNth: 5,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    // ten clicks held during the walk: replaying them through the flush must
    // not trip exceedCount from inside the flush
    for (let i = 0; i < 10; i++) {
      document.body.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    }

    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );
    await settle();
    await settle();

    // no coalesced follow-up fired with zero enforced gap
    expect(
      events.filter((e) => e.type === EventType.FullSnapshot).length,
    ).toBe(1);
    expect(events.filter((e) => e.type === EventType.Meta).length).toBe(1);

    // organic post-flush events still budget a checkout normally
    for (let i = 0; i < 5; i++) {
      document.body.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    }
    await vi.waitFor(
      () => {
        expect(
          events.filter((e) => e.type === EventType.FullSnapshot).length,
        ).toBe(2);
      },
      { timeout: 10_000 },
    );
  }, 20_000);

  it('a tab switch mid-walk does not drain the walk synchronously', async () => {
    fillBody();
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    Object.defineProperty(document, 'visibilityState', {
      get: () => 'hidden',
      configurable: true,
    });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      // no synchronous drain inside the dispatch task: an ordinary tab
      // switch must not run the rest of the document in one long task
      expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
        false,
      );
      // the walk still completes under its own scheduling
      await vi.waitFor(
        () => {
          expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
            true,
          );
        },
        { timeout: 10_000 },
      );
    } finally {
      delete (document as { visibilityState?: unknown }).visibilityState;
    }
  }, 20_000);

  it('pagehide with an aborted walk still produces a synchronous fallback snapshot', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fillBody();
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    // overflow the held queue: the walk is now abort-requested, but its
    // parked driver has not observed that yet
    for (let i = 0; i < 4200; i++) {
      record.addCustomEvent('queue-pressure', { index: i });
    }
    window.dispatchEvent(new Event('pagehide'));

    // a short busy visit still ends with a snapshot, synchronously in the
    // pagehide task, not with an orphan Meta
    expect(
      events.filter((e) => e.type === EventType.FullSnapshot).length,
    ).toBe(1);
    const statuses = diagnostics(events).map((p) => p?.status);
    expect(statuses).toContain('sync-fallback');
    // and not via a budgeted retry no dying page could finish
    expect(statuses).not.toContain('budgeted-retry');
    // an aborted walk must not claim success telemetry
    expect(statuses).not.toContain('completed');
  }, 20_000);

  it('a throwing mask fn during the pagehide drain aborts with a diagnostic, not a truncated tree', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fillBody();
    const events: eventWithTime[] = [];
    let blowUp = false;

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
      maskTextSelector: 'div',
      maskTextFn: (text: string) => {
        if (blowUp) {
          throw new Error('mask exploded');
        }
        return text;
      },
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    blowUp = true;
    // the drain dies mid-serialization; nothing may escape the handler and
    // no truncated FullSnapshot may go out (the fallback's mask throws too)
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    const statuses = diagnostics(events).map((p) => p?.status);
    expect(statuses).toContain('sync-fallback');
    expect(statuses).toContain('sync-fallback-failed');

    // the failure is contained: the recorder recovers on the next snapshot
    await settle();
    blowUp = false;
    record.takeFullSnapshot();
    await vi.waitFor(
      () => {
        expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );
  }, 20_000);

  it('a completed budgeted walk reports success telemetry on the wire', async () => {
    fillBody();
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    // the walk spans several tasks, so this event lands in the held window
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

    const completed = diagnostics(events).find(
      (p) => p?.status === 'completed',
    );
    expect(completed).toBeDefined();
    // the walk yielded at least once, so it ran at least two slices, and
    // every headline number is a real measurement rather than a placeholder
    expect(completed?.budgetMs).toBe(1);
    expect(completed?.isRetry).toBe(false);
    expect(completed?.walkMs as number).toBeGreaterThanOrEqual(0);
    expect(completed?.sliceCount as number).toBeGreaterThanOrEqual(2);
    expect(completed?.slowestSliceMs as number).toBeGreaterThanOrEqual(1);
    expect(completed?.heldEventHighWater as number).toBeGreaterThanOrEqual(1);
    // happy path: nothing dropped, nothing carried
    expect(completed?.carriedHeldEventCount).toBe(0);
    expect(completed?.droppedMutationRecords).toBe(0);
    expect(completed?.deferredMutationRecords).toBe(0);
    expect(completed?.droppedHeldEventCount).toBe(0);
    expect(completed?.failedHeldEventDeliveries).toBe(0);

    // delivered right behind the snapshot it describes, not held anywhere
    const fullIndex = events.findIndex(
      (e) => e.type === EventType.FullSnapshot,
    );
    const completedIndex = events.findIndex(
      (e) =>
        e.type === EventType.Custom &&
        (e as { data: { tag: string; payload?: { status?: string } } }).data
          .tag === 'budgeted-full-snapshot' &&
        (e as { data: { payload?: { status?: string } } }).data.payload
          ?.status === 'completed',
    );
    expect(completedIndex).toBeGreaterThan(fullIndex);

    // one success report per completed walk
    record.takeFullSnapshot();
    await vi.waitFor(
      () => {
        expect(
          diagnostics(events).filter((p) => p?.status === 'completed').length,
        ).toBe(2);
      },
      { timeout: 10_000 },
    );
  }, 20_000);

  it('the synchronous budget-0 path emits no success diagnostic', () => {
    fillBody(200);
    const events: eventWithTime[] = [];

    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
    });

    // both the initial snapshot and an explicit checkout are synchronous
    record.takeFullSnapshot();
    expect(
      events.filter((e) => e.type === EventType.FullSnapshot).length,
    ).toBe(2);
    expect(diagnostics(events)).toEqual([]);
  });

  it('isIgnored does not mint an id reservation for an unserialized mutation target', () => {
    const mirror = createMirror();
    let next = 1;
    mirror.beginIdReservation(() => next++);

    const target = document.createElement('div');
    document.body.appendChild(target);
    expect(isIgnored(target, mirror, slimDOMDefaults(false))).toBe(false);
    // the probe must be a peek: no reservation for a node no event references
    expect(mirror.getReservedId(target)).toBeUndefined();
    expect(mirror.getUnclaimedReservedIds()).toEqual([]);

    mirror.endIdReservation();
    document.body.removeChild(target);
  });

  it('a held interaction on a node removed mid-walk before its visit is dropped and counted', async () => {
    fillBody();
    // the victim sits AFTER the filler so the checkout walker reaches it late
    const victim = document.createElement('button');
    victim.id = 'dangling-victim';
    document.body.appendChild(victim);

    const events: eventWithTime[] = [];
    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    await vi.waitFor(
      () => {
        expect(
          events.filter((e) => e.type === EventType.FullSnapshot),
        ).toHaveLength(1);
      },
      { timeout: 10_000 },
    );
    await settle();
    const victimId = record.mirror.getId(victim);
    expect(victimId).toBeGreaterThan(0);

    // checkout: click the victim while the walk is in flight, then remove it
    // before the walker can reach it — the new snapshot will not contain it
    record.takeFullSnapshot(true);
    victim.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    victim.remove();

    await vi.waitFor(
      () => {
        expect(
          events.filter((e) => e.type === EventType.FullSnapshot),
        ).toHaveLength(2);
      },
      { timeout: 10_000 },
    );
    await settle();

    const full2 = events.filter((e) => e.type === EventType.FullSnapshot)[1];
    const full2Index = events.indexOf(full2);
    const danglingClicks = events
      .slice(full2Index)
      .filter(
        (e) =>
          e.type === EventType.IncrementalSnapshot &&
          (e as { data: { source: IncrementalSource } }).data.source ===
            IncrementalSource.MouseInteraction &&
          (e as unknown as { data: { id: number } }).data.id === victimId,
      );
    // not delivered dangling (the replayer would drop it silently)...
    expect(danglingClicks).toHaveLength(0);
    // ...and the loss is accounted, not invisible
    const reported = diagnostics(events).filter(
      (p) => (p?.droppedHeldEventCount as number) > 0,
    );
    expect(reported.length).toBeGreaterThan(0);
  }, 30_000);

  it('a session rotation does not reopen the shadow scroll blind window', async () => {
    fillBody();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    inner.textContent = 'shadow content';
    shadow.appendChild(inner);
    document.body.appendChild(host);

    const eventsA: eventWithTime[] = [];
    stop = record({
      emit: (event) => {
        eventsA.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });
    await vi.waitFor(
      () => {
        expect(eventsA.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );
    await settle();

    // the posthog-js rotation shape: stop() then record() on the same page.
    // The new session's first walk used to start with an empty registry and
    // no listener on the existing shadow root until the walker reached it.
    stop?.();
    const eventsB: eventWithTime[] = [];
    stop = record({
      emit: (event) => {
        eventsB.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });
    // dispatched while session B's first walk is in flight
    expect(eventsB.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    inner.dispatchEvent(new Event('scroll', { bubbles: true }));

    await vi.waitFor(
      () => {
        expect(eventsB.some((e) => e.type === EventType.FullSnapshot)).toBe(
          true,
        );
      },
      { timeout: 10_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 250));

    const innerId = record.mirror.getId(inner);
    const scrolls = eventsB.filter(
      (e) =>
        e.type === EventType.IncrementalSnapshot &&
        (e as { data: { source: IncrementalSource } }).data.source ===
          IncrementalSource.Scroll &&
        (e as unknown as { data: { id: number } }).data.id === innerId,
    );
    expect(scrolls.length).toBeGreaterThan(0);
  }, 30_000);

  it('drainPendingSnapshotForUnload finishes an in-flight walk synchronously', async () => {
    fillBody();
    const events: eventWithTime[] = [];
    stop = record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      fullSnapshotYieldBudgetMs: 1,
    });

    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(false);
    // what the SDK's pagehide handler calls before flushing its buffer —
    // the snapshot must exist by the time this returns, no awaiting
    record.drainPendingSnapshotForUnload();
    expect(events.some((e) => e.type === EventType.FullSnapshot)).toBe(true);

    // and it is a no-op once nothing is in flight
    const count = events.length;
    record.drainPendingSnapshotForUnload();
    expect(events.length).toBe(count);
  }, 20_000);

  describe('estimateRetainedSize hardening', () => {
    it('survives throwing enumerable getters and hostile proxies', () => {
      const withGetter = {};
      Object.defineProperty(withGetter, 'boom', {
        enumerable: true,
        get() {
          throw new Error('consumer getter');
        },
      });
      expect(() => estimateRetainedSize(withGetter, 1e9)).not.toThrow();

      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('hostile proxy');
          },
        },
      );
      expect(() =>
        estimateRetainedSize({ payload: hostile }, 1e9),
      ).not.toThrow();
    });

    it('counts Map, Set, Blob and ArrayBuffer contents instead of ~0', () => {
      const big = 'x'.repeat(10_000);
      expect(
        estimateRetainedSize(new Map([['key', big]]), 1e9),
      ).toBeGreaterThan(big.length);
      expect(estimateRetainedSize(new Set([big]), 1e9)).toBeGreaterThan(
        big.length,
      );
      expect(
        estimateRetainedSize(new ArrayBuffer(50_000), 1e9),
      ).toBeGreaterThanOrEqual(50_000);
      expect(
        estimateRetainedSize(new Blob([big]), 1e9),
      ).toBeGreaterThanOrEqual(big.length);
    });

    it('a spoofed toStringTag without a numeric size cannot poison the byte total', () => {
      const fakeMap = { [Symbol.toStringTag]: 'Map', payload: 'x'.repeat(100) };
      const bytes = estimateRetainedSize(fakeMap, 1e9);
      expect(Number.isFinite(bytes)).toBe(true);
      const fakeBlob = { [Symbol.toStringTag]: 'Blob' };
      expect(Number.isFinite(estimateRetainedSize(fakeBlob, 1e9))).toBe(true);
    });

    it('bounds its own traversal and reports over-ceiling instead of walking forever', () => {
      const wide = Array.from({ length: 200_000 }, () => ({}));
      const ceiling = Number.MAX_SAFE_INTEGER;
      expect(estimateRetainedSize(wide, ceiling)).toBeGreaterThan(ceiling);
    });
  });

  describe('scrubUnclaimedIds custom events', () => {
    const customEvent = (tag: string, payload: unknown): eventWithoutTime =>
      ({
        type: EventType.Custom,
        data: { tag, payload },
      }) as unknown as eventWithoutTime;

    it('never drops a consumer custom event whose payload id collides with a reservation', () => {
      const event = customEvent('checkout', { id: 42 });
      expect(scrubUnclaimedIds(event, new Set([42]))).toBe(event);
    });

    it('drops the internal fullscreen event when its target id was never claimed', () => {
      const event = customEvent(FullscreenCustomEventTag, {
        id: 42,
        enter: true,
      });
      expect(scrubUnclaimedIds(event, new Set([42]))).toBeNull();
    });

    it('keeps the internal fullscreen event when its target id was claimed', () => {
      const event = customEvent(FullscreenCustomEventTag, {
        id: 7,
        enter: true,
      });
      expect(scrubUnclaimedIds(event, new Set([42]))).toBe(event);
    });
  });

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
