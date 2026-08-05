/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/record/observers/canvas/canvas', () => ({
  default: () => () => {},
}));

vi.mock('../../src/record/observers/canvas/2d', () => ({
  default: () => () => {},
}));

vi.mock('../../src/record/observers/canvas/webgl', () => ({
  default: () => () => {},
}));

vi.mock(
  '../../src/record/workers/image-bitmap-data-url-worker?worker&inline',
  () => ({
    default: class {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage = vi.fn();
      terminate = vi.fn();
    },
  }),
);

import record, { inlineDeferredStylesheets } from '../../src/record';
import { StylesheetManager } from '../../src/record/stylesheet-manager';
import {
  getDeferredStylesheetStats,
  getLastSnapshotCost,
  resetSnapshotCostState,
  stringifyStylesheet,
} from '@posthog/rrweb-snapshot';
import { EventType, IncrementalSource, NodeType } from '@posthog/rrweb-types';
import type { eventWithTime, mutationCallBack } from '@posthog/rrweb-types';

type IdleDeadline = { didTimeout: boolean; timeRemaining: () => number };
type IdleCallback = (deadline: IdleDeadline) => void;

// a deadline that lets `n` slices run per idle callback before it expires
const deadlineForSlices = (n: number): IdleDeadline => {
  let checks = 0;
  return {
    didTimeout: false,
    timeRemaining: () => {
      checks += 1;
      return checks < n ? 50 : 0;
    },
  };
};

// a permanently busy page: the callback only ran because the rIC timeout fired
const busyDeadline = (): IdleDeadline => ({
  didTimeout: true,
  timeRemaining: () => 0,
});

describe('inlineDeferredStylesheets()', () => {
  let mutationCb: ReturnType<typeof vi.fn>;
  let scheduled: Map<number, IdleCallback>;
  let nextHandle: number;
  let cleanupNodes: Element[];
  let inlining: ReturnType<typeof inlineDeferredStylesheets> | undefined;

  const fireIdle = (deadline: IdleDeadline) => {
    const next = scheduled.entries().next().value as
      | [number, IdleCallback]
      | undefined;
    if (!next) {
      throw new Error('no idle callback scheduled');
    }
    scheduled.delete(next[0]);
    next[1](deadline);
  };

  const makeManager = () =>
    new StylesheetManager({
      mutationCb: mutationCb as unknown as mutationCallBack,
      adoptedStyleSheetCb: vi.fn(),
    });

  const makeLink = (ruleCount: number, id: number): HTMLLinkElement => {
    const rules: string[] = [];
    for (let i = 0; i < ruleCount; i++) {
      rules.push(`.rule-${id}-${i} { color: red; }`);
    }
    const styleEl = document.createElement('style');
    styleEl.textContent = rules.join('\n');
    document.head.appendChild(styleEl);
    const linkEl = document.createElement('link');
    document.head.appendChild(linkEl);
    Object.defineProperty(linkEl, 'sheet', { value: styleEl.sheet });
    record.mirror.add(linkEl, {
      type: NodeType.Element,
      tagName: 'link',
      attributes: {},
      childNodes: [],
      id,
    });
    cleanupNodes.push(styleEl, linkEl);
    return linkEl;
  };

  beforeEach(() => {
    resetSnapshotCostState();
    mutationCb = vi.fn();
    scheduled = new Map();
    nextHandle = 1;
    cleanupNodes = [];
    (
      window as unknown as { requestIdleCallback: unknown }
    ).requestIdleCallback = (cb: IdleCallback) => {
      const handle = nextHandle++;
      scheduled.set(handle, cb);
      return handle;
    };
    (window as unknown as { cancelIdleCallback: unknown }).cancelIdleCallback =
      (handle: number) => {
        scheduled.delete(handle);
      };
  });

  afterEach(() => {
    inlining?.cancel();
    inlining = undefined;
    cleanupNodes.forEach((node) => node.remove());
    record.mirror.reset();
    delete (window as unknown as { requestIdleCallback?: unknown })
      .requestIdleCallback;
    delete (window as unknown as { cancelIdleCallback?: unknown })
      .cancelIdleCallback;
  });

  it('slices a huge sheet across many idle callbacks and emits one atomic mutation', () => {
    const linkEl = makeLink(5000, 1); // 25 slices at 200 rules per slice
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const singlePass = stringifyStylesheet(linkEl.sheet!);
    const onDone = vi.fn();

    inlining = inlineDeferredStylesheets([linkEl], makeManager(), onDone);

    let callbacks = 0;
    while (scheduled.size > 0 && callbacks < 100) {
      fireIdle(deadlineForSlices(5));
      callbacks += 1;
      if (scheduled.size > 0) {
        // still mid-sheet: nothing may have been emitted yet
        expect(mutationCb).not.toHaveBeenCalled();
      }
    }

    // the deadline capped each callback at ~5 slices, so the sheet had to
    // spread across several idle periods instead of one long task
    expect(callbacks).toBeGreaterThanOrEqual(5);
    expect(mutationCb).toHaveBeenCalledTimes(1);
    expect(
      mutationCb.mock.calls[0][0].attributes[0].attributes._cssText,
    ).toBe(singlePass);
    expect(mutationCb.mock.calls[0][0].attributes[0].id).toBe(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('still advances on a permanently busy page, one slice per timed-out callback', () => {
    const linkEl = makeLink(600, 1); // 3 slices, plus one callback to finish
    const onDone = vi.fn();

    inlining = inlineDeferredStylesheets([linkEl], makeManager(), onDone);

    let callbacks = 0;
    while (scheduled.size > 0 && callbacks < 100) {
      fireIdle(busyDeadline());
      callbacks += 1;
    }

    expect(callbacks).toBe(4);
    expect(mutationCb).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('inlines multiple sheets in a single idle period when the deadline allows', () => {
    const linkA = makeLink(50, 1);
    const linkB = makeLink(50, 2);
    const onDone = vi.fn();

    inlining = inlineDeferredStylesheets([linkA, linkB], makeManager(), onDone);

    fireIdle({ didTimeout: false, timeRemaining: () => 50 });

    expect(scheduled.size).toBe(0);
    expect(mutationCb).toHaveBeenCalledTimes(2);
    expect(mutationCb.mock.calls[0][0].attributes[0].id).toBe(1);
    expect(mutationCb.mock.calls[1][0].attributes[0].id).toBe(2);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('spreads work across setTimeout ticks when idle callbacks are unavailable', () => {
    delete (window as unknown as { requestIdleCallback?: unknown })
      .requestIdleCallback;
    vi.useFakeTimers();
    try {
      const linkEl = makeLink(5000, 1); // 25 slices, 10 allowed per fallback tick
      const onDone = vi.fn();

      inlining = inlineDeferredStylesheets([linkEl], makeManager(), onDone);

      vi.advanceTimersByTime(250);
      vi.advanceTimersByTime(250);
      // two ticks of bounded work are not enough for the whole sheet
      expect(mutationCb).not.toHaveBeenCalled();

      vi.advanceTimersByTime(250);
      expect(mutationCb).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits nothing for a sheet cancelled mid-stringification', () => {
    const linkEl = makeLink(5000, 1);
    const onDone = vi.fn();

    inlining = inlineDeferredStylesheets([linkEl], makeManager(), onDone);

    fireIdle(deadlineForSlices(3)); // partway into the sheet
    expect(scheduled.size).toBe(1);

    inlining.cancel();
    inlining = undefined;

    expect(scheduled.size).toBe(0);
    expect(mutationCb).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('flush() synchronously finishes a partially-advanced cursor task', () => {
    const linkEl = makeLink(5000, 1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const singlePass = stringifyStylesheet(linkEl.sheet!);
    const onDone = vi.fn();

    inlining = inlineDeferredStylesheets([linkEl], makeManager(), onDone);

    fireIdle(deadlineForSlices(3)); // partway into the sheet
    expect(mutationCb).not.toHaveBeenCalled();

    inlining.flush();

    // the mid-sheet cursor was finished synchronously, byte-identical output
    expect(mutationCb).toHaveBeenCalledTimes(1);
    expect(mutationCb.mock.calls[0][0].attributes[0].attributes._cssText).toBe(
      singlePass,
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(scheduled.size).toBe(0);
    expect(getDeferredStylesheetStats().abandonedCount).toBe(0);
  });

  it('flush() stops at the safety cap and counts the abandoned sheets', () => {
    // 50 flush slices cover 10,000 rules: sheet A (31 slices incl. completion)
    // finishes, sheet B is caught mid-cursor, sheet C is never started
    const linkA = makeLink(6000, 1);
    const linkB = makeLink(6000, 2);
    const linkC = makeLink(50, 3);
    const onDone = vi.fn();

    inlining = inlineDeferredStylesheets(
      [linkA, linkB, linkC],
      makeManager(),
      onDone,
    );

    inlining.flush();

    expect(mutationCb).toHaveBeenCalledTimes(1);
    expect(mutationCb.mock.calls[0][0].attributes[0].id).toBe(1);
    expect(getDeferredStylesheetStats().abandonedCount).toBe(2);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(scheduled.size).toBe(0);
  });

  it('flush() after cancel() is a no-op', () => {
    const linkEl = makeLink(600, 1);
    const onDone = vi.fn();

    inlining = inlineDeferredStylesheets([linkEl], makeManager(), onDone);
    inlining.cancel();
    inlining.flush();

    expect(mutationCb).not.toHaveBeenCalled();
    expect(getDeferredStylesheetStats().abandonedCount).toBe(0);
  });
});

describe('record() teardown of deferred stylesheets', () => {
  let scheduled: Map<number, IdleCallback>;
  let nextHandle: number;
  let cleanupNodes: Element[];
  let events: eventWithTime[];
  let stop: (() => void) | undefined;

  const fireIdle = (deadline: IdleDeadline) => {
    const next = scheduled.entries().next().value as
      | [number, IdleCallback]
      | undefined;
    if (!next) {
      throw new Error('no idle callback scheduled');
    }
    scheduled.delete(next[0]);
    next[1](deadline);
  };

  const drainIdle = () => {
    let callbacks = 0;
    while (scheduled.size > 0 && callbacks < 500) {
      fireIdle({ didTimeout: false, timeRemaining: () => 50 });
      callbacks += 1;
    }
    expect(scheduled.size).toBe(0);
  };

  // unlike makeLink above, no manual mirror registration: the full snapshot
  // inside record() serializes the link and assigns its id
  const makeUnregisteredLink = (
    ruleCount: number,
    marker: string,
  ): HTMLLinkElement => {
    const rules: string[] = [];
    for (let i = 0; i < ruleCount; i++) {
      rules.push(`.${marker}-${i} { color: red; }`);
    }
    const styleEl = document.createElement('style');
    styleEl.textContent = rules.join('\n');
    document.head.appendChild(styleEl);
    const linkEl = document.createElement('link');
    document.head.appendChild(linkEl);
    Object.defineProperty(linkEl, 'sheet', { value: styleEl.sheet });
    cleanupNodes.push(styleEl, linkEl);
    return linkEl;
  };

  // the default budget is small enough that every test sheet is deferred
  const startRecording = (inlineStylesheetBudgetRules = 1) =>
    record({
      emit: (event) => {
        events.push(event as eventWithTime);
      },
      inlineStylesheetBudgetRules,
    });

  const cssTextMutations = (from: eventWithTime[]): string[] => {
    const texts: string[] = [];
    for (const event of from) {
      if (
        event.type !== EventType.IncrementalSnapshot ||
        event.data.source !== IncrementalSource.Mutation
      ) {
        continue;
      }
      for (const attribute of event.data.attributes ?? []) {
        const cssText = (attribute.attributes as Record<string, unknown>)
          ._cssText;
        if (typeof cssText === 'string') {
          texts.push(cssText);
        }
      }
    }
    return texts;
  };

  beforeEach(() => {
    resetSnapshotCostState();
    scheduled = new Map();
    nextHandle = 1;
    cleanupNodes = [];
    events = [];
    (
      window as unknown as { requestIdleCallback: unknown }
    ).requestIdleCallback = (cb: IdleCallback) => {
      const handle = nextHandle++;
      scheduled.set(handle, cb);
      return handle;
    };
    (window as unknown as { cancelIdleCallback: unknown }).cancelIdleCallback =
      (handle: number) => {
        scheduled.delete(handle);
      };
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    cleanupNodes.forEach((node) => node.remove());
    record.mirror.reset();
    delete (window as unknown as { requestIdleCallback?: unknown })
      .requestIdleCallback;
    delete (window as unknown as { cancelIdleCallback?: unknown })
      .cancelIdleCallback;
  });

  it('stop() mid-deferral flushes the queue synchronously, partially-advanced cursor included', () => {
    const linkEl = makeUnregisteredLink(1000, 'stop-flush');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const singlePass = stringifyStylesheet(linkEl.sheet!);
    stop = startRecording();
    expect(scheduled.size).toBe(1);

    fireIdle(deadlineForSlices(2)); // partway into the sheet's cursor
    expect(cssTextMutations(events)).toHaveLength(0);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    stop!();
    stop = undefined;

    const flushed = cssTextMutations(events);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toBe(singlePass);
    expect(scheduled.size).toBe(0);
    expect(getDeferredStylesheetStats().abandonedCount).toBe(0);
  });

  it('pagehide flushes the queue synchronously while recording continues', () => {
    const linkEl = makeUnregisteredLink(1000, 'pagehide-flush');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const singlePass = stringifyStylesheet(linkEl.sheet!);
    stop = startRecording();

    fireIdle(deadlineForSlices(2)); // partway into the sheet's cursor
    expect(cssTextMutations(events)).toHaveLength(0);

    window.dispatchEvent(new Event('pagehide'));

    const flushed = cssTextMutations(events);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toBe(singlePass);
    expect(scheduled.size).toBe(0);
  });

  it('loses no sheet across a full snapshot boundary: the new snapshot re-defers them', () => {
    makeUnregisteredLink(600, 'boundary-a');
    makeUnregisteredLink(600, 'boundary-b');
    stop = startRecording();

    // finish sheet A (4 slices) and leave sheet B mid-cursor (1 slice)
    fireIdle(deadlineForSlices(6));
    expect(cssTextMutations(events)).toHaveLength(1);

    // the new snapshot cancels the pending queue mid-sheet-B...
    record.takeFullSnapshot();
    const boundary = events.length;

    // ...but re-serializes every link, so both sheets are deferred again
    drainIdle();

    const afterBoundary = cssTextMutations(events.slice(boundary));
    expect(afterBoundary).toHaveLength(2);
    expect(
      afterBoundary.some((css) => css.includes('.boundary-a-599')),
    ).toBe(true);
    expect(
      afterBoundary.some((css) => css.includes('.boundary-b-599')),
    ).toBe(true);
    expect(getDeferredStylesheetStats().abandonedCount).toBe(0);
  });

  it('records the idle-time slices in the cumulative deferred duration stats', () => {
    makeUnregisteredLink(1000, 'timed');
    stop = startRecording();

    drainIdle();

    expect(cssTextMutations(events)).toHaveLength(1);
    const stats = getDeferredStylesheetStats();
    expect(stats.totalMs).toBeGreaterThan(0);
    expect(stats.slowestSliceMs).toBeGreaterThan(0);
    expect(stats.slowestSliceMs).toBeLessThanOrEqual(stats.totalMs);
    expect(stats.deferredCount).toBe(1);
  });

  it('does not let a CSSOM-only <style> push link sheets into deferral', () => {
    // styled-components/Emotion production mode: every rule lives only in the
    // CSSOM, so this sheet can never be deferred and must not charge the budget
    const cssomStyle = document.createElement('style');
    document.head.appendChild(cssomStyle);
    cleanupNodes.push(cssomStyle);
    for (let i = 0; i < 200; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      cssomStyle.sheet!.insertRule(`.cssom-${i} { color: red }`);
    }
    makeUnregisteredLink(20, 'cssom-companion');

    stop = startRecording(50);

    // the link fits the budget on its own, so nothing went to the idle queue
    expect(scheduled.size).toBe(0);
    expect(cssTextMutations(events)).toHaveLength(0);
    const cost = getLastSnapshotCost();
    expect(cost?.deferredStylesheetCount).toBe(0);
    expect(cost?.nonDeferrableCssRuleCount).toBe(200);
    expect(cost?.cssRuleCount).toBe(240); // 200 CSSOM + 20 style text + 20 link
  });

  it('counts document adoptedStyleSheets inside the snapshot cost window', () => {
    const burnMsPerRule = 2;
    const adoptedRules = Array.from({ length: 5 }, (_, i) => ({
      get cssText() {
        const until = Date.now() + burnMsPerRule;
        while (Date.now() < until) {
          /* burn */
        }
        return `.adopted-${i} { color: red }`;
      },
    }));
    const adoptedSheet = {
      href: null,
      rules: adoptedRules,
      cssRules: adoptedRules,
    } as unknown as CSSStyleSheet;
    Object.defineProperty(document, 'adoptedStyleSheets', {
      configurable: true,
      value: [adoptedSheet],
    });
    try {
      makeUnregisteredLink(2, 'adopted-companion');

      stop = startRecording(10);

      expect(scheduled.size).toBe(0);
      const cost = getLastSnapshotCost();
      expect(cost?.cssRuleCount).toBe(9); // 5 adopted + 2 style text + 2 link
      expect(cost?.nonDeferrableCssRuleCount).toBe(5);
      // the adopted stringification lands in the same synchronous freeze as the
      // snapshot, so both timers must cover it
      expect(cost?.stylesheetMs).toBeGreaterThanOrEqual(8);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(cost!.durationMs).toBeGreaterThanOrEqual(cost!.stylesheetMs);
      expect(cost?.deferredStylesheetCount).toBe(0);
    } finally {
      delete (document as { adoptedStyleSheets?: unknown })
        .adoptedStyleSheets;
    }
  });
});
