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
  /** wall-clock ms of the whole tracked window (the full snapshot task) */
  durationMs: number;
  /** of `durationMs`, ms spent stringifying stylesheets */
  stylesheetMs: number;
  /** DOM nodes visited by the serializer */
  nodeCount: number;
  /** CSSRules read while stringifying stylesheets, all sources */
  cssRuleCount: number;
  /**
   * of `cssRuleCount`, rules from sources that can never be deferred
   * (CSSOM-only `<style>` elements, adoptedStyleSheets). These do not charge
   * the inlining budget: deferring other sheets buys them no freeze reduction.
   */
  nonDeferrableCssRuleCount: number;
  /** `<link rel=stylesheet>` elements whose inlining was deferred past the budget */
  deferredStylesheetCount: number;
};

export type MutationCost = {
  /** slowest single mutation batch, in ms, since the last reset */
  slowestBatchMs: number;
};

/**
 * Session-cumulative accounting of budget-deferred stylesheets. `failedCount`
 * and `abandonedCount` are sheets that never made it back into the recording:
 * both leave the `<link>` serialized with only `rel`/`href`, so replay falls
 * back to loading the CSS from its original URL - which may 404 or have
 * changed by then.
 */
export type DeferredStylesheetStats = {
  /** deferral events across every snapshot (a re-deferred sheet counts again) */
  deferredCount: number;
  /** deferred sheets whose idle-time stringification produced nothing */
  failedCount: number;
  /** deferred sheets dropped when a teardown flush hit its safety cap */
  abandonedCount: number;
  /** ms spent stringifying deferred sheets, across every slice */
  totalMs: number;
  /** slowest single slice of deferred stringification, in ms */
  slowestSliceMs: number;
};

const emptyCost = (): SnapshotCost => ({
  durationMs: 0,
  stylesheetMs: 0,
  nodeCount: 0,
  cssRuleCount: 0,
  nonDeferrableCssRuleCount: 0,
  deferredStylesheetCount: 0,
});

const emptyDeferredStats = (): DeferredStylesheetStats => ({
  deferredCount: 0,
  failedCount: 0,
  abandonedCount: 0,
  totalMs: 0,
  slowestSliceMs: 0,
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

/**
 * A backgrounded renderer can be suspended (Page Lifecycle freeze, OS-level
 * process suspension) between a measurement's start and end reads, so a
 * wall-clock delta can measure sleep rather than main-thread work; fleet data
 * showed a full-snapshot "duration" of ~266s from exactly this. Two guards
 * keep those artifacts out of the gauges:
 * - a suspension generation, bumped by the recorder on `visibilitychange` and
 *   the Page Lifecycle `freeze`/`resume` events: a sample whose window
 *   straddles a bump is discarded. This catches multi-task windows and nested
 *   event loops (alert, sync XHR) inside otherwise synchronous windows;
 * - a plausibility cap: an OS suspension mid-task fires no event that a
 *   handler could observe mid-window, so a single-task window that "measures"
 *   longer than the cap is treated as having spanned a suspension.
 * Discarded samples are counted so the discard itself stays observable.
 */
let suspensionGeneration = 0;
let discardedDurationSamples = 0;

/**
 * 60s is deliberately generous: the slowest genuine synchronous snapshots in
 * fleet telemetry are single-digit seconds and browsers surface a
 * page-unresponsive prompt (or kill the renderer) well before a minute, while
 * a suspension routinely produces minutes to hours. No real sample can reach
 * it; any suspension long enough to matter will.
 */
export const MAX_PLAUSIBLE_SYNC_DURATION_MS = 60_000;

/** Recorder hook: the document changed visibility or froze/resumed. */
export function noteVisibilityChange(): void {
  suspensionGeneration += 1;
}

/** Capture at a measurement window's start; pass to the matching record call. */
export function getSuspensionGeneration(): number {
  return suspensionGeneration;
}

export function getDiscardedDurationSamples(): number {
  return discardedDurationSamples;
}

/** True (and counted) when a duration sample must not reach any gauge. */
function discardImplausibleDurationSample(
  ms: number,
  startGeneration: number,
): boolean {
  if (
    startGeneration !== suspensionGeneration ||
    ms > MAX_PLAUSIBLE_SYNC_DURATION_MS
  ) {
    discardedDurationSamples += 1;
    return true;
  }
  return false;
}

// `snapshot()` can legitimately re-enter (a caller snapshotting an iframe document
// from inside an onSerialize hook), so nest rather than clobbering the outer run.
let trackingDepth = 0;
let startedAt = 0;
let startGeneration = 0;
let inProgress: SnapshotCost = emptyCost();
let lastCost: SnapshotCost | null = null;

// null means "no budget in effect" - the incremental mutation path never opens a
// tracking scope, so stylesheet inlining there stays unbounded as before.
let stylesheetBudgetRules: number | null = null;
let deferredStylesheetLinks: HTMLLinkElement[] = [];
// the count survives `takeDeferredStylesheetLinks()`, which drains the array
// before the tracking window closes
let deferredLinkCount = 0;

// > 0 while stringifying a sheet the budget could never defer; see
// `runNonDeferrableStylesheetWork`
let nonDeferrableDepth = 0;

let mutationCost: MutationCost = { slowestBatchMs: 0 };

let deferredStylesheetStats: DeferredStylesheetStats = emptyDeferredStats();

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
  deferredLinkCount = 0;
  stylesheetBudgetRules = positiveOrNull(budgetRules);
  startedAt = nowMs();
  startGeneration = suspensionGeneration;
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
  inProgress.deferredStylesheetCount = deferredLinkCount;
  deferredStylesheetStats.deferredCount += deferredLinkCount;
  stylesheetBudgetRules = null;
  if (
    discardImplausibleDurationSample(inProgress.durationMs, startGeneration)
  ) {
    // only the timing is bogus: the deferral tally above counts real events,
    // but this cost must never become the slowest-snapshot record
    return inProgress;
  }
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

// Counting descends as deep as the CSS nests; past this we stop (undercount)
// rather than risk pathological recursion on adversarial stylesheets.
const MAX_COUNT_DEPTH = 32;

/**
 * Rules in a list, descending grouping rules (`@media`, `@supports`, `@layer`,
 * native nesting) to any depth - counting only the top level would let a
 * media-query-organised framework consume the budget at ~1 rule per block and
 * sail past the cap sheet after sheet. When `visitedSheets` is given, also
 * descends into `@import`ed sheets, each at most once so cyclic or
 * diamond-shaped import graphs terminate. Unreadable rules (cross-origin
 * `@import`) cost nothing: `stringifyStylesheet` can't read them either.
 */
function countRuleList(
  rules: CSSRuleList,
  visitedSheets: WeakSet<CSSStyleSheet> | null,
  depth: number,
): number {
  let total = rules.length;
  if (depth >= MAX_COUNT_DEPTH) {
    return total;
  }
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i] as CSSRule & {
      cssRules?: CSSRuleList;
      styleSheet?: CSSStyleSheet;
    };
    try {
      const nested = rule.cssRules;
      if (nested && nested.length) {
        total += countRuleList(nested, visitedSheets, depth + 1);
      } else if (visitedSheets && rule.styleSheet) {
        const imported = rule.styleSheet;
        if (!visitedSheets.has(imported)) {
          visitedSheets.add(imported);
          const importedRules = imported.rules || imported.cssRules;
          if (importedRules) {
            total += countRuleList(importedRules, visitedSheets, depth + 1);
          }
        }
      }
    } catch (e) {
      //
    }
  }
  return total;
}

/**
 * Charge a stringified sheet's rules to the running total, in the same units
 * as {@link safeCssRuleCount} estimates. `@import`ed sheets are charged by
 * their own `stringifyStylesheet` recursion, so they are not descended here.
 */
export function countStylesheetRules(rules: CSSRuleList): void {
  if (trackingDepth === 0) {
    return;
  }
  const counted = countRuleList(rules, null, 0);
  inProgress.cssRuleCount += counted;
  if (nonDeferrableDepth > 0) {
    inProgress.nonDeferrableCssRuleCount += counted;
  }
}

/**
 * Run `fn` with its stylesheet rule counts marked as never-deferrable. The
 * rules still show up in `cssRuleCount` (and in `nonDeferrableCssRuleCount`),
 * but they don't charge the inlining budget: a CSSOM-dominated page (e.g.
 * styled-components/Emotion `insertRule` output) gets no freeze reduction from
 * deferring, so charging it would push ordinary `<link>` sheets into deferral
 * for pure fidelity cost.
 */
export function runNonDeferrableStylesheetWork<T>(fn: () => T): T {
  nonDeferrableDepth += 1;
  try {
    return fn();
  } finally {
    nonDeferrableDepth -= 1;
  }
}

export function recordStylesheetCost(ms: number): void {
  if (trackingDepth > 0) {
    inProgress.stylesheetMs += ms;
  }
}

/**
 * Whether inlining `sheet` would take this snapshot past its stylesheet budget.
 * Always false when no budget is configured or no snapshot is in progress, i.e.
 * the incremental mutation path is never capped. Guards run before the rule
 * count so the unbudgeted paths never pay the walk over the sheet's rules.
 */
export function shouldDeferStylesheetInlining(
  sheet: CSSStyleSheet | null | undefined,
): boolean {
  if (trackingDepth === 0 || stylesheetBudgetRules === null) {
    return false;
  }
  // never-deferrable rules don't count against the budget (see
  // runNonDeferrableStylesheetWork)
  const chargedRuleCount =
    inProgress.cssRuleCount - inProgress.nonDeferrableCssRuleCount;
  if (chargedRuleCount >= stylesheetBudgetRules) {
    // budget already spent: defer without paying the rule walk
    return true;
  }
  return chargedRuleCount + safeCssRuleCount(sheet) > stylesheetBudgetRules;
}

/**
 * Rules a sheet would cost to stringify, or 0 when it can't be read at all
 * (e.g. cross-origin, where `stringifyStylesheet` bails immediately anyway).
 * A sheet that throws partway through still returns the rules counted so far:
 * returning 0 would wave a huge but partly-unreadable sheet past the budget.
 * See {@link countRuleList} for the nesting and `@import` descent rules.
 */
export function safeCssRuleCount(sheet: CSSStyleSheet | null | undefined) {
  try {
    const rules = sheet && (sheet.rules || sheet.cssRules);
    if (!rules) {
      return 0;
    }
    const visited = new WeakSet<CSSStyleSheet>();
    visited.add(sheet as CSSStyleSheet);
    return countRuleList(rules, visited, 0);
  } catch (e) {
    return 0;
  }
}

export function deferStylesheetLink(linkEl: HTMLLinkElement): void {
  if (trackingDepth > 0) {
    deferredStylesheetLinks.push(linkEl);
    deferredLinkCount += 1;
  }
}

/** Drains the links skipped by the budget. Safe to call after tracking ends. */
export function takeDeferredStylesheetLinks(): HTMLLinkElement[] {
  const links = deferredStylesheetLinks;
  deferredStylesheetLinks = [];
  return links;
}

export function recordDeferredStylesheetFailure(): void {
  deferredStylesheetStats.failedCount += 1;
}

export function recordDeferredStylesheetsAbandoned(count: number): void {
  if (count > 0) {
    deferredStylesheetStats.abandonedCount += count;
  }
}

/**
 * One bounded slice of deferred stylesheet stringification took `ms`.
 * `sliceStartGeneration` is the suspension generation captured when the slice
 * started; omitting it skips the straddle check but keeps the plausibility cap.
 */
export function recordDeferredStylesheetSlice(
  ms: number,
  sliceStartGeneration?: number,
): void {
  if (
    discardImplausibleDurationSample(
      ms,
      sliceStartGeneration ?? suspensionGeneration,
    )
  ) {
    return;
  }
  deferredStylesheetStats.totalMs += ms;
  if (ms > deferredStylesheetStats.slowestSliceMs) {
    deferredStylesheetStats.slowestSliceMs = ms;
  }
}

export function getDeferredStylesheetStats(): DeferredStylesheetStats {
  return { ...deferredStylesheetStats };
}

/** `batchStartGeneration`: see {@link recordDeferredStylesheetSlice}. */
export function recordMutationCost(
  ms: number,
  batchStartGeneration?: number,
): void {
  if (trackingDepth > 0) {
    // a batch drained inside the full-snapshot window (the post-snapshot buffer
    // unlock) is part of that snapshot's duration, not an incremental batch
    return;
  }
  if (
    discardImplausibleDurationSample(
      ms,
      batchStartGeneration ?? suspensionGeneration,
    )
  ) {
    return;
  }
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
  startGeneration = 0;
  suspensionGeneration = 0;
  discardedDurationSamples = 0;
  inProgress = emptyCost();
  lastCost = null;
  stylesheetBudgetRules = null;
  deferredStylesheetLinks = [];
  deferredLinkCount = 0;
  nonDeferrableDepth = 0;
  mutationCost = { slowestBatchMs: 0 };
  deferredStylesheetStats = emptyDeferredStats();
}
