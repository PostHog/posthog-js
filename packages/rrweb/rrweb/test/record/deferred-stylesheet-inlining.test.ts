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
import { stringifyStylesheet } from '@posthog/rrweb-snapshot';
import { NodeType } from '@posthog/rrweb-types';
import type { mutationCallBack } from '@posthog/rrweb-types';

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
  let cancel: (() => void) | undefined;

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
    cancel?.();
    cancel = undefined;
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

    cancel = inlineDeferredStylesheets([linkEl], makeManager(), onDone);

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

    cancel = inlineDeferredStylesheets([linkEl], makeManager(), onDone);

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

    cancel = inlineDeferredStylesheets([linkA, linkB], makeManager(), onDone);

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

      cancel = inlineDeferredStylesheets([linkEl], makeManager(), onDone);

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

    cancel = inlineDeferredStylesheets([linkEl], makeManager(), onDone);

    fireIdle(deadlineForSlices(3)); // partway into the sheet
    expect(scheduled.size).toBe(1);

    cancel();
    cancel = undefined;

    expect(scheduled.size).toBe(0);
    expect(mutationCb).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
