import {
  countStylesheetRules,
  createStylesheetTextCursor,
  getSuspensionGeneration,
  maskAttributeValue,
  nowMs,
  recordDeferredStylesheetFailure,
  recordDeferredStylesheetSlice,
  recordStylesheetCost,
  resetStylesheetLoadTracking,
  runNonDeferrableStylesheetWork,
  stringifyRule,
} from '@posthog/rrweb-snapshot';
import type {
  MaskAttributeFn,
  StylesheetTextCursor,
} from '@posthog/rrweb-snapshot';
import type {
  elementNode,
  serializedNodeWithId,
  adoptedStyleSheetCallback,
  adoptedStyleSheetParam,
  attributeMutation,
  mutationCallBack,
} from '@posthog/rrweb-types';
import { StyleSheetMirror } from '../utils';

/** Resumable inlining of one deferred stylesheet; see {@link StylesheetManager.beginDeferredLinkInlining}. */
export type DeferredLinkInliningTask = {
  /**
   * Stringify up to `maxRules` more rules of the sheet. Returns true once the
   * sheet is finished (its mutation emitted, or nothing to emit).
   */
  advance: (maxRules: number) => boolean;
  /** Lower bound on the rules still to stringify; see {@link StylesheetTextCursor.remainingRules}. */
  remainingRules: () => number;
  /**
   * Callers dropping the task without draining it must call this, so the
   * manager stops tracking its sheet for mutation invalidation.
   */
  discard: () => void;
};

/** One pending deferral's captured root sheet plus its cancellation hook. */
type PendingDeferredSheet = {
  sheet: CSSStyleSheet;
  invalidate: () => void;
};

export class StylesheetManager {
  private trackedLinkElements: WeakSet<HTMLLinkElement> = new WeakSet();
  private pendingDeferredSheets: Set<PendingDeferredSheet> = new Set();
  private mutationCb: mutationCallBack;
  private adoptedStyleSheetCb: adoptedStyleSheetCallback;
  private maskAllElementAttributes: boolean;
  private maskAttributeFn: MaskAttributeFn | undefined;
  public styleMirror = new StyleSheetMirror();

  constructor(options: {
    mutationCb: mutationCallBack;
    adoptedStyleSheetCb: adoptedStyleSheetCallback;
    maskAllElementAttributes?: boolean;
    maskAttributeFn?: MaskAttributeFn;
  }) {
    this.mutationCb = options.mutationCb;
    this.adoptedStyleSheetCb = options.adoptedStyleSheetCb;
    this.maskAllElementAttributes = options.maskAllElementAttributes ?? false;
    this.maskAttributeFn = options.maskAttributeFn;
  }

  public attachLinkElement(
    linkEl: HTMLLinkElement,
    childSn: serializedNodeWithId,
  ) {
    if ('_cssText' in (childSn as elementNode).attributes)
      this.mutationCb({
        adds: [],
        removes: [],
        texts: [],
        attributes: [
          {
            id: childSn.id,
            attributes: (childSn as elementNode)
              .attributes as attributeMutation['attributes'],
          },
        ],
      });

    this.trackLinkElement(linkEl);
  }

  /**
   * Inline a `<link rel=stylesheet>` that the full snapshot skipped because it
   * ran out of stylesheet budget. The returned task stringifies a bounded rule
   * range per `advance` call, accumulating across calls, and emits ONE
   * attribute mutation carrying the complete `_cssText` when the last slice
   * finishes - a partial sheet never reaches the wire, and dropping the task
   * mid-sheet emits nothing and leaks nothing. Same mutation shape as
   * {@link attachLinkElement} - the replayer swaps the link for a `<style>`
   * carrying `_cssText`. Returns null when there is nothing to inline.
   */
  public beginDeferredLinkInlining(
    linkEl: HTMLLinkElement,
    id: number,
  ): DeferredLinkInliningTask | null {
    if (id === -1 || !linkEl.isConnected) {
      // never made it into the mirror (slimDOM dropped it), or detached while we
      // were queued - either way a mutation for it would only make the replayer warn
      return null;
    }
    let cursor: StylesheetTextCursor | null = null;
    let capturedSheet: CSSStyleSheet | null = null;
    try {
      capturedSheet = linkEl.sheet;
      if (capturedSheet) {
        cursor = createStylesheetTextCursor(capturedSheet);
      }
    } catch (e) {
      //
    }
    if (!cursor || !capturedSheet) {
      // the sheet is unreadable, so the link keeps its href and replay must
      // load the CSS remotely - a fidelity risk worth counting, not hiding
      recordDeferredStylesheetFailure();
      return null;
    }
    const readyCursor = cursor;
    // Registered so the recorder's CSSOM observers can cancel this task; see
    // onCssomSheetMutation for why an unnoticed mutation would corrupt replay.
    let invalidatedByMutation = false;
    const pendingEntry: PendingDeferredSheet = {
      sheet: capturedSheet,
      invalidate: () => {
        invalidatedByMutation = true;
      },
    };
    this.pendingDeferredSheets.add(pendingEntry);
    let completed = false;
    return {
      advance: (maxRules: number) => {
        // a flush() re-entered from inside this sheet's own emit (a full
        // snapshot or recorder stop taken from within the consumer's emit)
        // advances the already-done cursor again; the terminal block below,
        // the emit included, must run exactly once
        if (completed) {
          return true;
        }
        // deferred work runs outside the snapshot's tracking window, so the
        // snapshot timers miss it; measure each slice (emit included) here
        const startedAt = nowMs();
        const startGeneration = getSuspensionGeneration();
        let finished = true;
        try {
          if (invalidatedByMutation) {
            completed = true;
            // emitting the defer-time text now would overwrite the mutation's
            // already-recorded StyleSheetRule/StyleDeclaration event in replay;
            // the link keeps its href, a counted fidelity loss
            recordDeferredStylesheetFailure();
            return true;
          }
          if (!readyCursor.advance(maxRules)) {
            finished = false;
            return false;
          }
          completed = true;
          const cssText = readyCursor.text();
          if (!linkEl.isConnected) {
            // the link left the DOM while we were slicing; the replay drops it too
            return true;
          }
          let currentSheet: CSSStyleSheet | null = null;
          try {
            currentSheet = linkEl.sheet;
          } catch (e) {
            //
          }
          if (currentSheet !== capturedSheet) {
            // the link's href was swapped while we were slicing (an SPA style
            // change): emitting the old sheet's CSS now would override the new
            // stylesheet in replay, which arrives via its own mutation flow.
            // The old CSS is lost, so count it like any other failed deferral.
            recordDeferredStylesheetFailure();
            return true;
          }
          if (!cssText) {
            // stringification produced nothing: the link keeps its href and replay
            // must load the CSS remotely - a fidelity risk worth counting, not hiding
            recordDeferredStylesheetFailure();
            return true;
          }
          this.emitCssTextMutation(linkEl, id, cssText);
          return true;
        } finally {
          if (finished) {
            this.pendingDeferredSheets.delete(pendingEntry);
          }
          recordDeferredStylesheetSlice(nowMs() - startedAt, startGeneration);
        }
      },
      remainingRules: () => readyCursor.remainingRules(),
      discard: () => {
        this.pendingDeferredSheets.delete(pendingEntry);
      },
    };
  }

  /**
   * Recorder hook: application code mutated `sheet` through the CSSOM
   * (insertRule/deleteRule/setProperty/removeProperty). A pending deferral
   * whose captured root sheet is `sheet` must never emit: the mutation was
   * already recorded as a StyleSheetRule/StyleDeclaration event, and a later
   * `_cssText` mutation carrying the defer-time text would overwrite it in
   * replay. Cancelling keeps the link's href-only fallback, and the loss is
   * counted when the task next advances. Mutations to `@import`ed sheets
   * inside a captured chain deliberately do NOT invalidate: an imported sheet
   * has no ownerNode and is not in the style mirror, so the observers cannot
   * attribute (and never emit) an event for it - there is nothing the
   * defer-time text could overwrite, and that text is exactly what a
   * synchronous pass at defer time would have recorded.
   */
  public onCssomSheetMutation(sheet: CSSStyleSheet | null | undefined): void {
    if (!sheet || this.pendingDeferredSheets.size === 0) {
      return;
    }
    for (const pending of this.pendingDeferredSheets) {
      if (pending.sheet === sheet) {
        this.pendingDeferredSheets.delete(pending);
        pending.invalidate();
      }
    }
  }

  /** One-call variant of {@link beginDeferredLinkInlining}: the whole sheet in a single slice. */
  public inlineDeferredLinkElement(linkEl: HTMLLinkElement, id: number) {
    this.beginDeferredLinkInlining(linkEl, id)?.advance(Infinity);
  }

  private emitCssTextMutation(
    linkEl: HTMLLinkElement,
    id: number,
    cssText: string,
  ) {
    // The snapshot path masks _cssText inside serializeElementNode; this path
    // builds the value itself, so it has to mask it too.
    this.mutationCb({
      adds: [],
      removes: [],
      texts: [],
      attributes: [
        {
          id,
          attributes: {
            _cssText: maskAttributeValue({
              element: linkEl,
              name: '_cssText',
              value: cssText,
              maskAllElementAttributes: this.maskAllElementAttributes,
              maskAttributeFn: this.maskAttributeFn,
            }),
          },
        },
      ],
    });
  }

  public trackLinkElement(linkEl: HTMLLinkElement) {
    if (this.trackedLinkElements.has(linkEl)) return;

    this.trackedLinkElements.add(linkEl);
    this.trackStylesheetInLinkElement(linkEl);
  }

  public adoptStyleSheets(
    sheets: CSSStyleSheet[] | readonly CSSStyleSheet[],
    hostId: number,
  ) {
    if (sheets.length === 0) return;
    const adoptedStyleSheetData: adoptedStyleSheetParam = {
      id: hostId,
      styleIds: [] as number[],
    };
    const styles: NonNullable<adoptedStyleSheetParam['styles']> = [];
    for (const sheet of sheets) {
      let styleId: number;
      if (!this.styleMirror.has(sheet)) {
        const newStyleId = this.styleMirror.add(sheet);
        styleId = newStyleId;
        // synchronous stringification with no deferral path: charge it to the
        // css counters (never-deferrable, so it never charges the budget); the
        // no-op outside a full snapshot's tracking window keeps the
        // incremental adoption path unmeasured, as before
        const startedAt = nowMs();
        try {
          runNonDeferrableStylesheetWork(() => {
            try {
              const sheetRules = sheet.rules || sheet.cssRules;
              if (sheetRules) {
                countStylesheetRules(sheetRules);
              }
            } catch (e) {
              //
            }
            styles.push({
              styleId: newStyleId,
              rules: Array.from(sheet.rules || CSSRule, (r, index) => ({
                rule: stringifyRule(r, sheet.href),
                index,
              })),
            });
          });
        } finally {
          recordStylesheetCost(nowMs() - startedAt);
        }
      } else styleId = this.styleMirror.getId(sheet);
      adoptedStyleSheetData.styleIds.push(styleId);
    }
    if (styles.length > 0) adoptedStyleSheetData.styles = styles;
    this.adoptedStyleSheetCb(adoptedStyleSheetData);
  }

  public reset() {
    this.styleMirror.reset();
    this.trackedLinkElements = new WeakSet();
    // any surviving deferral registrations belong to tasks the recorder
    // cancelled at the snapshot boundary; drop them so they don't pin sheets
    this.pendingDeferredSheets.clear();
    resetStylesheetLoadTracking();
  }

  // TODO: take snapshot on stylesheet reload by applying event listener
  private trackStylesheetInLinkElement(_linkEl: HTMLLinkElement) {
    // linkEl.addEventListener('load', () => {
    //   // re-loaded, maybe take another snapshot?
    // });
  }
}
