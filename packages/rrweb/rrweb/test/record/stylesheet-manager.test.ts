/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StylesheetManager } from '../../src/record/stylesheet-manager';
import {
  beginSnapshotCostTracking,
  endSnapshotCostTracking,
  getDeferredStylesheetStats,
  resetSnapshotCostState,
  shouldDeferStylesheetInlining,
  stringifyStylesheet,
} from '@posthog/rrweb-snapshot';
import type { mutationCallBack } from '@posthog/rrweb-types';

/**
 * jsdom stringifies rules too fast to measure, so fake sheets whose `cssText`
 * access burns wall-clock, which is where the cost lands in real browsers.
 */
function makeBurningSheet(ruleCount: number, costMsPerRule: number) {
  const rules = Array.from({ length: ruleCount }, (_, i) => ({
    get cssText() {
      const until = Date.now() + costMsPerRule;
      while (Date.now() < until) {
        /* burn */
      }
      return `.rule-${i} { color: red }`;
    },
  }));
  return { href: null, rules, cssRules: rules } as unknown as CSSStyleSheet;
}

describe('StylesheetManager.inlineDeferredLinkElement()', () => {
  const LINK_ID = 7;
  const CSS = '.owner::after {content: "alice@example.com";}';
  let mutationCb: ReturnType<typeof vi.fn>;
  let linkEl: HTMLLinkElement;
  let styleEl: HTMLStyleElement;

  const emittedCssText = () =>
    mutationCb.mock.calls[0][0].attributes[0].attributes._cssText as string;

  const makeManager = (
    options: Partial<ConstructorParameters<typeof StylesheetManager>[0]> = {},
  ) =>
    new StylesheetManager({
      mutationCb: mutationCb as unknown as mutationCallBack,
      adoptedStyleSheetCb: vi.fn(),
      ...options,
    });

  beforeEach(() => {
    mutationCb = vi.fn();
    // jsdom does not load stylesheets for <link>, so borrow a real sheet
    // from a <style> element and expose it on the link.
    styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);
    linkEl = document.createElement('link');
    document.head.appendChild(linkEl);
    Object.defineProperty(linkEl, 'sheet', { value: styleEl.sheet });
  });

  afterEach(() => {
    styleEl.remove();
    linkEl.remove();
  });

  it('emits the raw stylesheet when no masking is configured', () => {
    makeManager().inlineDeferredLinkElement(linkEl, LINK_ID);

    expect(emittedCssText()).toContain('alice@example.com');
  });

  it('masks the emitted _cssText under maskAllElementAttributes', () => {
    makeManager({ maskAllElementAttributes: true }).inlineDeferredLinkElement(
      linkEl,
      LINK_ID,
    );

    expect(emittedCssText()).toMatch(/^\*+$/);
  });

  it('routes the emitted _cssText through maskAttributeFn', () => {
    const maskAttributeFn = vi.fn(() => '[CSS-MASKED]');

    makeManager({ maskAttributeFn }).inlineDeferredLinkElement(
      linkEl,
      LINK_ID,
    );

    expect(emittedCssText()).toBe('[CSS-MASKED]');
    expect(maskAttributeFn).toHaveBeenCalledWith(
      '_cssText',
      expect.stringContaining('alice@example.com'),
      linkEl,
    );
  });
});

describe('StylesheetManager.beginDeferredLinkInlining()', () => {
  const LINK_ID = 7;
  const RULE_COUNT = 50_000;
  const RULES_PER_SLICE = 200;
  let mutationCb: ReturnType<typeof vi.fn>;
  let linkEl: HTMLLinkElement;
  let styleEl: HTMLStyleElement;

  const emittedCssText = () =>
    mutationCb.mock.calls[0][0].attributes[0].attributes._cssText as string;

  const makeManager = () =>
    new StylesheetManager({
      mutationCb: mutationCb as unknown as mutationCallBack,
      adoptedStyleSheetCb: vi.fn(),
    });

  beforeEach(() => {
    resetSnapshotCostState();
    mutationCb = vi.fn();
    const rules: string[] = [];
    for (let i = 0; i < RULE_COUNT; i++) {
      rules.push(`.rule-${i} { color: red; }`);
    }
    styleEl = document.createElement('style');
    styleEl.textContent = rules.join('\n');
    document.head.appendChild(styleEl);
    linkEl = document.createElement('link');
    document.head.appendChild(linkEl);
    Object.defineProperty(linkEl, 'sheet', { value: styleEl.sheet });
  });

  afterEach(() => {
    styleEl.remove();
    linkEl.remove();
  });

  it('stringifies a 50k-rule sheet across many bounded slices and emits one atomic mutation', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const singlePass = stringifyStylesheet(linkEl.sheet!);
    const task = makeManager().beginDeferredLinkInlining(linkEl, LINK_ID);
    expect(task).not.toBeNull();

    let boundedSlices = 0;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    while (!task!.advance(RULES_PER_SLICE)) {
      boundedSlices += 1;
      // no partial _cssText ever reaches the wire
      expect(mutationCb).not.toHaveBeenCalled();
    }

    // exactly RULES_PER_SLICE rules per slice, so a single long task is impossible
    expect(boundedSlices).toBe(RULE_COUNT / RULES_PER_SLICE);
    expect(mutationCb).toHaveBeenCalledTimes(1);
    expect(emittedCssText()).toBe(singlePass);
  });

  it('emits nothing when the task is dropped mid-sheet, and a fresh task still works', () => {
    const manager = makeManager();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const abandoned = manager.beginDeferredLinkInlining(linkEl, LINK_ID)!;
    abandoned.advance(RULES_PER_SLICE);
    abandoned.advance(RULES_PER_SLICE);
    // cancelled here: the task is simply dropped
    expect(mutationCb).not.toHaveBeenCalled();

    // no state leaks outside the task: a restart stringifies the full sheet
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const restarted = manager.beginDeferredLinkInlining(linkEl, LINK_ID)!;
    while (!restarted.advance(RULES_PER_SLICE)) {
      // drain
    }
    expect(mutationCb).toHaveBeenCalledTimes(1);
    expect(emittedCssText()).toContain(`.rule-${RULE_COUNT - 1}`);
  });

  it('emits nothing when the link is detached while slicing, and does not count it as failed', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const task = makeManager().beginDeferredLinkInlining(linkEl, LINK_ID)!;
    task.advance(RULES_PER_SLICE);
    linkEl.remove();
    while (!task.advance(RULES_PER_SLICE)) {
      // drain
    }
    expect(mutationCb).not.toHaveBeenCalled();
    // the replay drops the removed link too, so no fidelity was lost
    expect(getDeferredStylesheetStats().failedCount).toBe(0);
  });

  it('returns null when the link never made it into the mirror', () => {
    expect(makeManager().beginDeferredLinkInlining(linkEl, -1)).toBeNull();
    expect(getDeferredStylesheetStats().failedCount).toBe(0);
  });

  it('counts a failure when the sheet is unreadable at begin time', () => {
    const brokenLink = document.createElement('link');
    document.head.appendChild(brokenLink);
    try {
      // no sheet at all: nothing can ever be inlined, only the href remains
      expect(
        makeManager().beginDeferredLinkInlining(brokenLink, LINK_ID),
      ).toBeNull();
      expect(getDeferredStylesheetStats().failedCount).toBe(1);
    } finally {
      brokenLink.remove();
    }
  });

  it('records each slice into the cumulative deferred duration stats', () => {
    const burningLink = document.createElement('link');
    document.head.appendChild(burningLink);
    Object.defineProperty(burningLink, 'sheet', {
      value: makeBurningSheet(6, 2),
    });
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const task = makeManager().beginDeferredLinkInlining(
        burningLink,
        LINK_ID,
      )!;
      expect(task.advance(3)).toBe(false); // first slice, >= 6ms
      expect(task.advance(Infinity)).toBe(true); // second slice, >= 6ms

      const stats = getDeferredStylesheetStats();
      expect(stats.totalMs).toBeGreaterThanOrEqual(8);
      expect(stats.slowestSliceMs).toBeGreaterThan(0);
      // two slices ran, so the slowest one cannot account for all the time
      expect(stats.slowestSliceMs).toBeLessThan(stats.totalMs);
    } finally {
      burningLink.remove();
    }
  });

  it('counts a failure when stringification produces nothing at idle time', () => {
    const brokenLink = document.createElement('link');
    document.head.appendChild(brokenLink);
    const throwingSheet = {
      get rules(): CSSRuleList {
        throw new Error('cross-origin');
      },
      get cssRules(): CSSRuleList {
        throw new Error('cross-origin');
      },
    };
    Object.defineProperty(brokenLink, 'sheet', { value: throwingSheet });
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const task = makeManager().beginDeferredLinkInlining(
        brokenLink,
        LINK_ID,
      )!;
      expect(task.advance(RULES_PER_SLICE)).toBe(true);
      expect(mutationCb).not.toHaveBeenCalled();
      expect(getDeferredStylesheetStats().failedCount).toBe(1);
    } finally {
      brokenLink.remove();
    }
  });
});

describe('StylesheetManager.adoptStyleSheets()', () => {
  let adoptedStyleSheetCb: ReturnType<typeof vi.fn>;

  const makeManager = () =>
    new StylesheetManager({
      mutationCb: vi.fn() as unknown as mutationCallBack,
      adoptedStyleSheetCb,
    });

  beforeEach(() => {
    resetSnapshotCostState();
    adoptedStyleSheetCb = vi.fn();
  });

  afterEach(() => {
    resetSnapshotCostState();
  });

  it('charges adopted sheets to the css counters as never-deferrable work', () => {
    const manager = makeManager();
    const sheet = makeBurningSheet(30, 1);

    beginSnapshotCostTracking(20);
    manager.adoptStyleSheets([sheet], 1);
    // 30 adopted rules exceed the budget of 20, but they can never be
    // deferred, so a small link sheet must still fit
    expect(shouldDeferStylesheetInlining(makeBurningSheet(10, 0))).toBe(false);
    // re-adopting the same sheet reuses the mirror entry: no double counting
    manager.adoptStyleSheets([sheet], 2);
    const cost = endSnapshotCostTracking();

    expect(cost.cssRuleCount).toBe(30);
    expect(cost.nonDeferrableCssRuleCount).toBe(30);
    expect(cost.stylesheetMs).toBeGreaterThanOrEqual(20);
    expect(adoptedStyleSheetCb).toHaveBeenCalledTimes(2);
  });

  it('does not count adoption outside a snapshot window (the incremental path)', () => {
    makeManager().adoptStyleSheets([makeBurningSheet(5, 0)], 1);

    beginSnapshotCostTracking(null);
    const cost = endSnapshotCostTracking();
    expect(cost.cssRuleCount).toBe(0);
    expect(adoptedStyleSheetCb).toHaveBeenCalledTimes(1);
  });
});
