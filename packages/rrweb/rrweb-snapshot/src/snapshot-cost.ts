/**
 * Snapshot cost accounting.
 *
 * Serializing the DOM is unbounded synchronous work on the main thread: a wide,
 * shallow, stylesheet-heavy document can hold the thread for seconds, which the
 * page sees as a total UI freeze. The existing `maxDepth` guard only bounds
 * *deep* documents, so that whole class of cost was previously unmeasured.
 *
 * This module keeps the measurement in one place so both `snapshot()` and the
 * incremental mutation path can report how much time they spent, and so the
 * expensive-by-far part - `stringifyStylesheet` over every CSSRule of every
 * sheet - can be capped and deferred instead of blocking first paint.
 */

export type SnapshotCost = {
  /** wall-clock ms spent inside `snapshot()` */
  durationMs: number;
  /** of `durationMs`, ms spent stringifying stylesheets */
  stylesheetMs: number;
  /** DOM nodes visited by the serializer */
  nodeCount: number;
  /** CSSRules read while stringifying stylesheets */
  cssRuleCount: number;
  /** `<link rel=stylesheet>` elements whose inlining was deferred past the budget */
  deferredStylesheetCount: number;
};

export type MutationCost = {
  /** total ms spent processing mutation batches since the last reset */
  totalMs: number;
  /** slowest single mutation batch, in ms, since the last reset */
  slowestBatchMs: number;
};

const emptyCost = (): SnapshotCost => ({
  durationMs: 0,
  stylesheetMs: 0,
  nodeCount: 0,
  cssRuleCount: 0,
  deferredStylesheetCount: 0,
});

export function nowMs(): number {
  try {
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now();
    }
  } catch (e) {
    //
  }
  return Date.now();
}

// `snapshot()` can legitimately re-enter (a caller snapshotting an iframe document
// from inside an onSerialize hook), so nest rather than clobbering the outer run.
let trackingDepth = 0;
let startedAt = 0;
let inProgress: SnapshotCost = emptyCost();
let lastCost: SnapshotCost | null = null;

// null means "no budget in effect" - the incremental mutation path never opens a
// tracking scope, so stylesheet inlining there stays unbounded as before.
let stylesheetBudgetRules: number | null = null;
let deferredStylesheetLinks: HTMLLinkElement[] = [];

let mutationCost: MutationCost = { totalMs: 0, slowestBatchMs: 0 };

const positiveOrNull = (n: number | null | undefined) =>
  n && n > 0 ? n : null;

/**
 * @param budgetRules cap on the number of CSSRules this snapshot may stringify.
 * Sheets beyond the cap are collected by {@link takeDeferredStylesheetLinks} so the
 * caller can inline them off the critical path. Pass `null`/`0` for no cap.
 *
 * Rule count rather than elapsed time, deliberately: elapsed time makes the split
 * depend on how contended the machine happens to be, so the same page would defer
 * different sheets from load to load. Rule count is a stable proxy - `cssText` cost
 * is roughly uniform per rule - and keeps the emitted event stream deterministic.
 */
export function beginSnapshotCostTracking(budgetRules?: number | null): void {
  trackingDepth += 1;
  if (trackingDepth > 1) {
    return;
  }
  inProgress = emptyCost();
  deferredStylesheetLinks = [];
  stylesheetBudgetRules = positiveOrNull(budgetRules);
  startedAt = nowMs();
}

export function endSnapshotCostTracking(): SnapshotCost {
  if (trackingDepth === 0) {
    return lastCost || emptyCost();
  }
  trackingDepth -= 1;
  if (trackingDepth > 0) {
    return inProgress;
  }
  inProgress.durationMs = nowMs() - startedAt;
  inProgress.deferredStylesheetCount = deferredStylesheetLinks.length;
  stylesheetBudgetRules = null;
  lastCost = inProgress;
  return lastCost;
}

/** Cost of the most recent completed `snapshot()`, or null if none has run. */
export function getLastSnapshotCost(): SnapshotCost | null {
  return lastCost;
}

export function countSerializedNode(): void {
  if (trackingDepth > 0) {
    inProgress.nodeCount += 1;
  }
}

export function countCssRules(count: number): void {
  if (trackingDepth > 0) {
    inProgress.cssRuleCount += count;
  }
}

export function recordStylesheetCost(ms: number): void {
  if (trackingDepth > 0) {
    inProgress.stylesheetMs += ms;
  }
}

/**
 * Whether inlining a sheet with `ruleCount` rules would take this snapshot past
 * its stylesheet budget. Always false when no budget is configured or no snapshot
 * is in progress, i.e. the incremental mutation path is never capped.
 */
export function shouldDeferStylesheetInlining(ruleCount: number): boolean {
  return (
    trackingDepth > 0 &&
    stylesheetBudgetRules !== null &&
    inProgress.cssRuleCount + ruleCount > stylesheetBudgetRules
  );
}

/**
 * Rules a sheet would cost to stringify, or 0 when it can't be read (e.g.
 * cross-origin, where `stringifyStylesheet` bails immediately anyway).
 *
 * Descends one level into grouping (`@media`, `@supports`) and `@import` rules,
 * which are a single CSSRule each however many rules they hold - without that a
 * media-query-organised framework would look almost free and slip past the cap.
 */
export function safeCssRuleCount(sheet: CSSStyleSheet | null | undefined) {
  try {
    const rules = sheet && (sheet.rules || sheet.cssRules);
    if (!rules) {
      return 0;
    }
    let total = rules.length;
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i] as CSSRule & {
        cssRules?: CSSRuleList;
        styleSheet?: CSSStyleSheet;
      };
      total += rule.cssRules?.length || rule.styleSheet?.cssRules?.length || 0;
    }
    return total;
  } catch (e) {
    return 0;
  }
}

export function deferStylesheetLink(linkEl: HTMLLinkElement): void {
  if (trackingDepth > 0) {
    deferredStylesheetLinks.push(linkEl);
  }
}

/** Drains the links skipped by the budget. Safe to call after tracking ends. */
export function takeDeferredStylesheetLinks(): HTMLLinkElement[] {
  const links = deferredStylesheetLinks;
  deferredStylesheetLinks = [];
  return links;
}

export function recordMutationCost(ms: number): void {
  mutationCost.totalMs += ms;
  if (ms > mutationCost.slowestBatchMs) {
    mutationCost.slowestBatchMs = ms;
  }
}

export function getMutationCost(): MutationCost {
  return { ...mutationCost };
}

export function resetSnapshotCostState(): void {
  trackingDepth = 0;
  startedAt = 0;
  inProgress = emptyCost();
  lastCost = null;
  stylesheetBudgetRules = null;
  deferredStylesheetLinks = [];
  mutationCost = { totalMs: 0, slowestBatchMs: 0 };
}
