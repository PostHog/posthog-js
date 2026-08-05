import {
  createStylesheetTextCursor,
  maskAttributeValue,
  recordDeferredStylesheetFailure,
  resetStylesheetLoadTracking,
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
};

export class StylesheetManager {
  private trackedLinkElements: WeakSet<HTMLLinkElement> = new WeakSet();
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
    try {
      const sheet = linkEl.sheet;
      if (sheet) {
        cursor = createStylesheetTextCursor(sheet);
      }
    } catch (e) {
      //
    }
    if (!cursor) {
      // the sheet is unreadable, so the link keeps its href and replay must
      // load the CSS remotely - a fidelity risk worth counting, not hiding
      recordDeferredStylesheetFailure();
      return null;
    }
    const readyCursor = cursor;
    return {
      advance: (maxRules: number) => {
        if (!readyCursor.advance(maxRules)) {
          return false;
        }
        const cssText = readyCursor.text();
        if (!linkEl.isConnected) {
          // the link left the DOM while we were slicing; the replay drops it too
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
      },
    };
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
      let styleId;
      if (!this.styleMirror.has(sheet)) {
        styleId = this.styleMirror.add(sheet);
        styles.push({
          styleId,
          rules: Array.from(sheet.rules || CSSRule, (r, index) => ({
            rule: stringifyRule(r, sheet.href),
            index,
          })),
        });
      } else styleId = this.styleMirror.getId(sheet);
      adoptedStyleSheetData.styleIds.push(styleId);
    }
    if (styles.length > 0) adoptedStyleSheetData.styles = styles;
    this.adoptedStyleSheetCb(adoptedStyleSheetData);
  }

  public reset() {
    this.styleMirror.reset();
    this.trackedLinkElements = new WeakSet();
    resetStylesheetLoadTracking();
  }

  // TODO: take snapshot on stylesheet reload by applying event listener
  private trackStylesheetInLinkElement(_linkEl: HTMLLinkElement) {
    // linkEl.addEventListener('load', () => {
    //   // re-loaded, maybe take another snapshot?
    // });
  }
}
