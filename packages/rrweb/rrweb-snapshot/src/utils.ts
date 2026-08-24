import type {
  idNodeMap,
  MaskAttributeFn,
  MaskInputFn,
  MaskInputOptions,
  nodeMetaMap,
} from './types';

import { NodeType } from '@posthog/rrweb-types';
import type {
  IMirror,
  serializedNodeWithId,
  serializedNode,
  documentNode,
  documentTypeNode,
  textNode,
  elementNode,
} from '@posthog/rrweb-types';
import dom from '@posthog/rrweb-utils';
import {
  countStylesheetRules,
  nowMs,
  recordStylesheetCost,
} from './snapshot-cost';

export function isElement(n: Node): n is Element {
  return n.nodeType === n.ELEMENT_NODE;
}

export function isShadowRoot(n: Node): n is ShadowRoot {
  const hostEl: Element | null =
    // anchor and textarea elements also have a `host` property
    // but only shadow roots have a `mode` property
    (n && 'host' in n && 'mode' in n && dom.host(n as ShadowRoot)) || null;
  return Boolean(
    hostEl && 'shadowRoot' in hostEl && dom.shadowRoot(hostEl) === n,
  );
}

/**
 * Attach an open shadow root to a rebuilt element and report whether it worked.
 * Two different things can refuse. A real element is only accepted when its tag
 * is a valid shadow host name per the DOM spec, so a rebuilt host can be refused
 * where the recorded one was not, and `attachShadow` raises a `NotSupportedError`
 * that the full-snapshot rebuild does not catch, ending playback. Under the
 * virtual DOM the element is an `RRElement`, and `RRMediaElement` refuses every
 * time. Callers use the return value to skip that one subtree instead.
 */
export function attachShadowRootSafely(el: {
  attachShadow(init: ShadowRootInit): unknown;
}): boolean {
  try {
    el.attachShadow({ mode: 'open' });
    return true;
  } catch {
    return false;
  }
}

/**
 * To fix the issue https://github.com/rrweb-io/rrweb/issues/933.
 * Some websites use polyfilled shadow dom and this function is used to detect this situation.
 */
export function isNativeShadowDom(shadowRoot: ShadowRoot): boolean {
  return Object.prototype.toString.call(shadowRoot) === '[object ShadowRoot]';
}

/**
 * Browsers sometimes destructively modify the css rules they receive.
 * This function tries to rectify the modifications the browser made to make it more cross platform compatible.
 * @param cssText - output of `CSSStyleRule.cssText`
 * @returns `cssText` with browser inconsistencies fixed.
 */
function fixBrowserCompatibilityIssuesInCSS(cssText: string): string {
  /**
   * Chrome outputs `-webkit-background-clip` as `background-clip` in `CSSStyleRule.cssText`.
   * But then Chrome ignores `background-clip` as css input.
   * Re-introduce `-webkit-background-clip` to fix this issue.
   */
  if (
    cssText.includes(' background-clip: text;') &&
    !cssText.includes(' -webkit-background-clip: text;')
  ) {
    cssText = cssText.replace(
      /\sbackground-clip:\s*text;/g,
      ' -webkit-background-clip: text; background-clip: text;',
    );
  }
  return cssText;
}

// Remove this declaration once typescript has added `CSSImportRule.supportsText` to the lib.
declare interface CSSImportRule extends CSSRule {
  readonly href: string;
  readonly layerName: string | null;
  readonly media: MediaList;
  readonly styleSheet: CSSStyleSheet;
  /**
   * experimental API, currently only supported in firefox
   * https://developer.mozilla.org/en-US/docs/Web/API/CSSImportRule/supportsText
   */
  readonly supportsText?: string | null;
}

/**
 * Browsers sometimes incorrectly escape `@import` on `.cssText` statements.
 * This function tries to correct the escaping.
 * more info: https://bugs.chromium.org/p/chromium/issues/detail?id=1472259
 * @param cssImportRule
 * @returns `cssText` with browser inconsistencies fixed, or null if not applicable.
 */
export function escapeImportStatement(rule: CSSImportRule): string {
  const { cssText } = rule;
  if (cssText.split('"').length < 3) return cssText;

  const statement = ['@import', `url(${JSON.stringify(rule.href)})`];
  if (rule.layerName === '') {
    statement.push(`layer`);
  } else if (rule.layerName) {
    statement.push(`layer(${rule.layerName})`);
  }
  if (rule.supportsText) {
    statement.push(`supports(${rule.supportsText})`);
  }
  if (rule.media.length) {
    statement.push(rule.media.mediaText);
  }
  return statement.join(' ') + ';';
}

/**
 * Detects empty property values produced by browser CSSOM serialization of
 * shorthands that contain `var()`. When a stylesheet has e.g.
 *
 *     .card { padding: var(--p); padding-bottom: var(--pb); }
 *
 * browsers store the shorthand's longhands with empty token lists per the
 * CSS Custom Properties spec, and `CSSStyleRule.cssText` re-emits them as
 * `padding-top: ; padding-right: ; padding-left: ;`. That output silently
 * strips the layout from the rule on replay. Same class of bug as
 * rrweb-io/rrweb#1667. Custom properties (`--foo: ;`) are intentionally
 * allowed to be empty and are excluded.
 */
export function hasEmptyShorthandLonghand(css: string): boolean {
  // The optional leading `-` admits vendor-prefixed longhands
  // (e.g. `-webkit-mask-image: ;`) while still excluding custom
  // properties (`--foo: ;`), since the second char must be a letter.
  return /(?:^|[\s;{}])-?[a-zA-Z][\w-]*\s*:\s*;/.test(css);
}

// `stringifyStylesheet` recurses into `@import`ed sheets, so only the outermost
// call owns the wall-clock measurement - otherwise nested sheets get counted twice.
let stringifyStylesheetDepth = 0;

export function stringifyStylesheet(s: CSSStyleSheet): string | null {
  const isOutermost = stringifyStylesheetDepth === 0;
  const startedAt = isOutermost ? nowMs() : 0;
  stringifyStylesheetDepth += 1;
  try {
    const rules = s.rules || s.cssRules;
    if (!rules) {
      return null;
    }
    countStylesheetRules(rules);
    let sheetHref = s.href;
    if (!sheetHref && s.ownerNode) {
      // an inline <style> element
      sheetHref = s.ownerNode.baseURI;
    }
    const stringifiedRules = Array.from(rules, (rule: CSSRule) =>
      stringifyRule(rule, sheetHref),
    ).join('');
    return fixBrowserCompatibilityIssuesInCSS(stringifiedRules);
  } catch (error) {
    return null;
  } finally {
    stringifyStylesheetDepth -= 1;
    if (isOutermost) {
      recordStylesheetCost(nowMs() - startedAt);
    }
  }
}

export function stringifyRule(rule: CSSRule, sheetHref: string | null): string {
  if (isCSSImportRule(rule)) {
    let importStringified;
    try {
      importStringified =
        // for same-origin stylesheets,
        // we can access the imported stylesheet rules directly
        stringifyStylesheet(rule.styleSheet) ||
        // work around browser issues with the raw string `@import url(...)` statement
        escapeImportStatement(rule);
    } catch (error) {
      importStringified = rule.cssText;
    }
    // if importStringified is not null,
    // there should be a stylesheet and a rule here,
    // but we avoid errors in this method by checking for null
    // see https://github.com/rrweb-io/rrweb/pull/1686
    try {
      if (importStringified && rule.styleSheet?.href) {
        // url()s within the imported stylesheet are relative to _that_ sheet's href
        return absolutifyURLs(importStringified, rule.styleSheet.href);
      }
    } catch {
      // swallow this, we'll return null
    }
    return importStringified;
  } else {
    let ruleStringified = rule.cssText;
    if (isCSSStyleRule(rule) && rule.selectorText.includes(':')) {
      // Safari does not escape selectors with : properly
      // see https://bugs.webkit.org/show_bug.cgi?id=184604
      ruleStringified = fixSafariColons(ruleStringified);
    }
    if (sheetHref) {
      return absolutifyURLs(ruleStringified, sheetHref);
    }
    return ruleStringified;
  }
}

export function fixSafariColons(cssStringified: string): string {
  // Replace e.g. [aa:bb] with [aa\\:bb]
  const regex = /(\[(?:[\w-]+)[^\\])(:(?:[\w-]+)\])/gm;
  return cssStringified.replace(regex, '$1\\$2');
}

export function isCSSImportRule(rule: CSSRule): rule is CSSImportRule {
  return 'styleSheet' in rule;
}

export function isCSSStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return 'selectorText' in rule;
}

/**
 * Resumable, slice-at-a-time variant of {@link stringifyStylesheet}.
 *
 * A huge sheet (tens of thousands of rules) takes hundreds of ms to stringify,
 * which in a single pass is one uninterruptible main-thread task. The cursor
 * stringifies a bounded number of rules per {@link StylesheetTextCursor.advance}
 * call and accumulates the parts across calls, so a caller can spread the work
 * over idle slices. Nothing is observable until the sheet completes: `text()`
 * then returns output equivalent to `stringifyStylesheet` on the same sheet
 * (`fixBrowserCompatibilityIssuesInCSS` runs at each sheet's final assembly,
 * exactly as the single pass does), byte-identical except for grouping rules
 * (`@media`, `@supports`, `@layer`, `@container`, `@keyframes`, nested style
 * rules - see {@link getGroupingRulePrelude} for the exceptions that stay
 * one-shot), which are reassembled from their children and can differ from
 * the browser's own serialization in inter-rule whitespace only.
 * `@import`ed sheets are descended with the same cursor, so a slice boundary
 * can fall inside an import chain.
 *
 * The rule lists of the root sheet AND of every readable sheet in its
 * `@import` chain are snapshotted at cursor creation, so the eventual text
 * reflects the whole chain as it was at creation ("defer time") - the same
 * text a synchronous pass at creation would have produced. CSSOM mutations
 * made while the cursor is mid-flight are deliberately not folded in: the
 * caller observes rule mutations separately and treats "the captured sheet
 * was mutated after defer" as its signal to discard the cursor's output.
 */
export interface StylesheetTextCursor {
  /**
   * Stringify up to `maxRules` further rules, with a floor of one so progress
   * is always made. Returns true once the sheet - imports included - is done.
   */
  advance(maxRules: number): boolean;
  /** The assembled css text. Null until done, and null for unreadable sheets. */
  text(): string | null;
  /**
   * Lower bound on the rules still to stringify: what remains in the frames
   * opened so far. An un-descended `@import` or grouping rule counts as one
   * until its frame opens, so the bound tightens as traversal proceeds.
   */
  remainingRules(): number;
}

// One per sheet mid-stringification: the root sheet at the bottom, plus one for
// each `@import` currently being descended.
type SheetFrame = {
  kind: 'sheet';
  sheet: CSSStyleSheet;
  rules: CSSRule[];
  sheetHref: string | null;
  index: number;
  parts: string[];
  /** the `@import` rule in the parent frame that opened this frame; null for the root */
  importRule: CSSImportRule | null;
};

// One per grouping rule (`@media`, `@supports`, `@layer`, `@container`,
// `@keyframes`, nested style rules) mid-stringification. Reading a grouping
// rule's `cssText` serializes its entire nested tree synchronously, so one
// giant grouping rule would recreate exactly the long task this cursor exists
// to prevent; its children are stringified rule-by-rule instead and
// reassembled behind the prelude when the frame completes.
type GroupFrame = {
  kind: 'group';
  rules: CSSRule[];
  sheetHref: string | null;
  index: number;
  parts: string[];
  /** e.g. `@media (min-width: 500px) {`; the closing `}` is appended at completion */
  prelude: string;
  /**
   * The single pass runs {@link fixSafariColons} over a top-level style
   * rule's whole cssText, nested children included; set for frames opened
   * from such a rule so the reassembled text gets the same treatment.
   */
  fixColons: boolean;
};

type StringifyFrame = SheetFrame | GroupFrame;

// Reconstructing `@layer a.b {` or `@keyframes name {` from the CSSOM `name`
// property is only safe when the name needs no CSS escaping (the property
// exposes the unescaped name), so exotic names keep the one-shot read.
const CSS_IDENT = /^-?[A-Za-z_][\w-]*$/;
const CSS_LAYER_NAME = /^-?[A-Za-z_][\w-]*(\.-?[A-Za-z_][\w-]*)*$/;

/**
 * The opening text of a grouping rule whose children will be stringified
 * individually, or null for rules that must keep the one-shot `cssText` read.
 *
 * Resumable: `@media`, `@supports`, `@layer` blocks (named, dotted, or
 * anonymous), `@container` (its name is not reliably part of `conditionText`,
 * so it is rebuilt from `containerName`/`containerQuery`), `@keyframes`, and
 * natively-nested style rules (their declaration block never appears among
 * `cssRules`, so it rides in the prelude). Kept one-shot because their
 * prelude cannot be rebuilt from reliable CSSOM properties: childless rules,
 * names that would need CSS escaping, `@container` without `containerQuery`
 * support, `@page` (margin boxes; shares `selectorText` with style rules but
 * keeps legacy type 6), and grouping types with no distinguishing property to
 * duck-type on (`@scope`, `@starting-style`).
 */
function getGroupingRulePrelude(rule: CSSRule): string | null {
  const grouping = rule as CSSRule & {
    cssRules?: CSSRuleList;
    media?: MediaList;
    conditionText?: string;
    containerName?: string;
    containerQuery?: string;
    name?: string;
    style?: CSSStyleDeclaration;
    type?: number;
  };
  if (!grouping.cssRules || grouping.cssRules.length === 0) {
    return null;
  }
  // `@media`; CSSImportRule also has `media` but never `cssRules`
  if (grouping.media && typeof grouping.media.mediaText === 'string') {
    return `@media ${grouping.media.mediaText} {`;
  }
  if (isCSSStyleRule(rule)) {
    // `@page` also exposes selectorText; every engine reports style rules as
    // legacy type 1 (and 0 for never-listed types), page rules as 6
    if (typeof grouping.type === 'number' && grouping.type !== 1) {
      return null;
    }
    const declarations = grouping.style ? grouping.style.cssText : '';
    return `${rule.selectorText} {${declarations ? ' ' + declarations : ''}`;
  }
  if ('containerName' in grouping) {
    if (
      typeof grouping.containerQuery !== 'string' ||
      (grouping.containerName && !CSS_IDENT.test(grouping.containerName))
    ) {
      return null;
    }
    const name = grouping.containerName ? `${grouping.containerName} ` : '';
    return `@container ${name}${grouping.containerQuery} {`;
  }
  if (typeof grouping.conditionText === 'string') {
    // conditionText alone does not pin @supports: CSSContainerRule on engines
    // predating containerQuery (Chrome 105-110, Safari 16.0) and Gecko's
    // @-moz-document expose it too, and a @supports prelude would change what
    // their condition means at replay. Trust the constructor name, allowing
    // engines that predate `Function.name` (which also predate every other
    // conditionText rule type).
    let ruleType = '';
    try {
      ruleType = rule.constructor?.name || '';
    } catch (e) {
      return null;
    }
    if (
      ruleType === '' ||
      ruleType === 'Object' ||
      ruleType === 'CSSSupportsRule'
    ) {
      return `@supports ${grouping.conditionText} {`;
    }
    return null;
  }
  if (typeof grouping.name === 'string') {
    // `@keyframes` and `@layer` blocks both expose `name`; only a keyframes
    // rule's children carry `keyText`
    const firstChild = grouping.cssRules[0] as CSSRule & { keyText?: string };
    if ('keyText' in firstChild) {
      return CSS_IDENT.test(grouping.name)
        ? `@keyframes ${grouping.name} {`
        : null;
    }
    if (grouping.name === '') {
      return '@layer {';
    }
    return CSS_LAYER_NAME.test(grouping.name)
      ? `@layer ${grouping.name} {`
      : null;
  }
  return null;
}

// Everything the traversal needs from one `@import`ed sheet, captured at
// cursor creation. Null records that reading `rule.styleSheet` threw, which
// keeps the raw-cssText fallback the single pass uses for that case.
type CapturedImport = {
  sheet: CSSStyleSheet;
  rules: CSSRule[];
  sheetHref: string | null;
} | null;

export function createStylesheetTextCursor(
  sheet: CSSStyleSheet,
): StylesheetTextCursor {
  const stack: StringifyFrame[] = [];
  let done = false;
  let result: string | null = null;

  // Capture-at-creation keeps the whole chain's text fixed to its defer-time
  // state: a lazy read when traversal reaches an import would fold mid-flight
  // CSSOM mutations into the text - state newer than the snapshot the caller
  // deferred, and newer than any rule mutations recorded in between.
  const capturedImports = new Map<CSSImportRule, CapturedImport>();

  function captureImportChain(
    rootRules: CSSRule[],
    rootSheet: CSSStyleSheet,
  ): void {
    // explicit walk stack: import chains can be arbitrarily deep
    const walk = [{ sheet: rootSheet, rules: rootRules, index: 0 }];
    while (walk.length > 0) {
      const top = walk[walk.length - 1];
      if (top.index >= top.rules.length) {
        walk.pop();
        continue;
      }
      const rule = top.rules[top.index];
      top.index += 1;
      if (!isCSSImportRule(rule) || capturedImports.has(rule)) {
        continue;
      }
      let imported: CSSStyleSheet | null = null;
      try {
        imported = rule.styleSheet;
      } catch (e) {
        capturedImports.set(rule, null);
        continue;
      }
      // guard true import cycles, which the single-pass recursion has no
      // terminating path for; the rule falls back to its `@import url(...)` form
      if (!imported || walk.some((entry) => entry.sheet === imported)) {
        continue;
      }
      try {
        const importedRules = imported.rules || imported.cssRules;
        if (!importedRules) {
          continue;
        }
        countStylesheetRules(importedRules);
        let sheetHref = imported.href;
        if (!sheetHref && imported.ownerNode) {
          sheetHref = imported.ownerNode.baseURI;
        }
        const snapshot = Array.from(importedRules);
        capturedImports.set(rule, { sheet: imported, rules: snapshot, sheetHref });
        walk.push({ sheet: imported, rules: snapshot, index: 0 });
      } catch (e) {
        // unreadable (e.g. cross-origin): traversal keeps the statement fallback
      }
    }
  }

  // mirrors the setup of `stringifyStylesheet`, budget accounting included;
  // failure means this sheet stringifies to null
  function openRootFrame(s: CSSStyleSheet): boolean {
    try {
      const rules = s.rules || s.cssRules;
      if (!rules) {
        return false;
      }
      countStylesheetRules(rules);
      let sheetHref = s.href;
      if (!sheetHref && s.ownerNode) {
        // an inline <style> element
        sheetHref = s.ownerNode.baseURI;
      }
      // Snapshot the live CSSRuleList (root and, via captureImportChain, the
      // whole import chain): application insertRule()/deleteRule() calls
      // between idle slices would shift the numeric indexes the cursor resumes
      // by, skipping or duplicating rules. Post-creation CSSOM mutations are
      // therefore never reflected here - the same semantics as a single
      // synchronous pass taken at defer time.
      const snapshot = Array.from(rules);
      stack.push({
        kind: 'sheet',
        sheet: s,
        rules: snapshot,
        sheetHref,
        index: 0,
        parts: [],
        importRule: null,
      });
      captureImportChain(snapshot, s);
      return true;
    } catch (e) {
      return false;
    }
  }

  // Opens a resumable frame over a grouping rule's children; returns false
  // when the rule keeps the one-shot `cssText` read instead. Never throws.
  function tryOpenGroupFrame(rule: CSSRule, parent: StringifyFrame): boolean {
    try {
      const prelude = getGroupingRulePrelude(rule);
      if (prelude === null) {
        return false;
      }
      const sheetHref = parent.sheetHref;
      stack.push({
        kind: 'group',
        // snapshot, for the same reason openRootFrame snapshots the sheet's rules
        rules: Array.from((rule as CSSRule & { cssRules: CSSRuleList }).cssRules),
        sheetHref,
        index: 0,
        parts: [],
        // a nested style rule's prelude carries its declarations, which can
        // hold url()s; the single pass absolutifies them within the whole-rule
        // cssText, so the prelude needs the same treatment
        prelude: sheetHref ? absolutifyURLs(prelude, sheetHref) : prelude,
        fixColons:
          parent.kind === 'sheet' &&
          isCSSStyleRule(rule) &&
          rule.selectorText.includes(':'),
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // The top frame finished (text) or failed (null). A grouping rule's text is
  // appended to the frame it appears in; a sheet resolves into its `@import`
  // rule, exactly as `stringifyRule` handles the recursive
  // `stringifyStylesheet` return value; the root frame finishes the cursor.
  function completeTop(text: string | null): void {
    const frame = stack.pop() as StringifyFrame;
    if (frame.kind === 'group') {
      if (text === null) {
        // a child threw while stringifying: in the single pass that throw
        // happens while reading the enclosing sheet's rules, so the whole
        // sheet fails, nested grouping frames included
        while (
          stack.length > 0 &&
          stack[stack.length - 1].kind === 'group'
        ) {
          stack.pop();
        }
        completeTop(null);
        return;
      }
      const parent = stack[stack.length - 1];
      parent.parts.push(text);
      parent.index += 1;
      return;
    }
    if (!frame.importRule) {
      done = true;
      result = text;
      return;
    }
    resolveImport(stack[stack.length - 1], frame.importRule, text);
  }

  // Appends the resolved text of an `@import` rule (`nested` is what the
  // imported sheet stringified to, null if unreadable) and steps past the rule.
  // `parent` must be the top frame.
  function resolveImport(
    parent: StringifyFrame,
    rule: CSSImportRule,
    nested: string | null,
  ): void {
    try {
      let importStringified: string | null;
      try {
        importStringified = nested || escapeImportStatement(rule);
      } catch (e) {
        importStringified = rule.cssText;
      }
      try {
        if (importStringified && rule.styleSheet?.href) {
          // url()s within the imported stylesheet are relative to _that_ sheet's href
          importStringified = absolutifyURLs(
            importStringified,
            rule.styleSheet.href,
          );
        }
      } catch (e) {
        // swallow and keep the unabsolutified text, as `stringifyRule` does
      }
      if (importStringified) {
        parent.parts.push(importStringified);
      }
      parent.index += 1;
    } catch (e) {
      // the fallback itself threw reading the rule: the parent sheet fails,
      // matching where that throw would land in the single pass
      completeTop(null);
    }
  }

  // Stringifies the rule at frame.index; descends into readable same-origin
  // imports and into grouping rules by opening a child frame. Throws only
  // where the same throw fails the whole sheet in the single-pass version.
  function stepRule(frame: StringifyFrame): void {
    const rule = frame.rules[frame.index];
    if (frame.kind === 'sheet' && isCSSImportRule(rule)) {
      const captured = capturedImports.get(rule);
      if (captured === null) {
        // reading `rule.styleSheet` threw at capture time; the single pass
        // lands in `stringifyRule`'s catch here: raw cssText, with no escape
        // or absolutify fallback
        frame.parts.push(rule.cssText);
        frame.index += 1;
        return;
      }
      if (captured) {
        stack.push({
          kind: 'sheet',
          sheet: captured.sheet,
          rules: captured.rules,
          sheetHref: captured.sheetHref,
          index: 0,
          parts: [],
          importRule: rule,
        });
        // descend; frame.index advances when the child frame completes
        return;
      }
      // cyclic or unreadable at capture time: keep the statement fallback
      resolveImport(frame, rule, null);
      return;
    }
    if (tryOpenGroupFrame(rule, frame)) {
      // descend; frame.index advances when the group frame completes
      return;
    }
    let ruleStringified = rule.cssText;
    if (
      frame.kind === 'sheet' &&
      isCSSStyleRule(rule) &&
      rule.selectorText.includes(':')
    ) {
      // Safari does not escape selectors with : properly
      // see https://bugs.webkit.org/show_bug.cgi?id=184604
      // top-level rules only: the single pass never rewrites the text inside
      // a grouping rule's cssText, and this path stays byte-compatible with it
      ruleStringified = fixSafariColons(ruleStringified);
    }
    frame.parts.push(
      frame.sheetHref
        ? absolutifyURLs(ruleStringified, frame.sheetHref)
        : ruleStringified,
    );
    frame.index += 1;
  }

  if (!openRootFrame(sheet)) {
    done = true;
  }

  return {
    advance(maxRules: number): boolean {
      if (done) {
        return true;
      }
      const startedAt = nowMs();
      // NaN/zero/negative floor to one rule, so callers always make progress
      let budget = maxRules > 0 ? maxRules : 1;
      try {
        while (!done && budget > 0) {
          const frame = stack[stack.length - 1];
          if (frame.index >= frame.rules.length) {
            let text: string | null = null;
            try {
              // per-sheet browser-compat fixing only, exactly as the single
              // pass: a grouping rule's text is fixed as part of its sheet's
              if (frame.kind === 'group') {
                const assembled = frame.prelude + frame.parts.join('') + '}';
                text = frame.fixColons ? fixSafariColons(assembled) : assembled;
              } else {
                text = fixBrowserCompatibilityIssuesInCSS(
                  frame.parts.join(''),
                );
              }
            } catch (e) {
              // e.g. the joined text overflows the string limit; the sheet fails
            }
            completeTop(text);
            continue;
          }
          budget -= 1;
          try {
            stepRule(frame);
          } catch (e) {
            // matches the catch-all in `stringifyStylesheet`: the sheet fails
            completeTop(null);
          }
        }
      } catch (e) {
        // belt and braces - `stringifyStylesheet` never throws, nor does advance
        done = true;
        result = null;
      } finally {
        recordStylesheetCost(nowMs() - startedAt);
      }
      return done;
    },
    text: () => (done ? result : null),
    remainingRules: () => {
      if (done) {
        return 0;
      }
      let remaining = 0;
      for (const frame of stack) {
        remaining += frame.rules.length - frame.index;
      }
      return remaining;
    },
  };
}

export class Mirror implements IMirror<Node> {
  private idNodeMap: idNodeMap = new Map();
  private nodeMetaMap: nodeMetaMap = new WeakMap();

  getId(n: Node | undefined | null): number {
    if (!n) return -1;

    const id = this.getMeta(n)?.id;

    // if n is not a serialized Node, use -1 as its id.
    return id ?? -1;
  }

  getNode(id: number): Node | null {
    return this.idNodeMap.get(id) || null;
  }

  getIds(): number[] {
    return Array.from(this.idNodeMap.keys());
  }

  getMeta(n: Node): serializedNodeWithId | null {
    return this.nodeMetaMap.get(n) || null;
  }

  // removes the node from idNodeMap
  // doesn't remove the node from nodeMetaMap
  removeNodeFromMap(n: Node) {
    const id = this.getId(n);
    this.idNodeMap.delete(id);

    if (n.childNodes) {
      n.childNodes.forEach((childNode) =>
        this.removeNodeFromMap(childNode as unknown as Node),
      );
    }

    if (isElement(n)) {
      const shadowRootEl = dom.shadowRoot(n);
      if (shadowRootEl) {
        this.removeNodeFromMap(shadowRootEl as unknown as Node);
      }

      if (n.nodeName === 'IFRAME' && (n as HTMLIFrameElement).contentDocument) {
        this.removeNodeFromMap(
          (n as HTMLIFrameElement).contentDocument as unknown as Node,
        );
      }
    }
  }
  has(id: number): boolean {
    return this.idNodeMap.has(id);
  }

  hasNode(node: Node): boolean {
    return this.nodeMetaMap.has(node);
  }

  add(n: Node, meta: serializedNodeWithId) {
    const id = meta.id;
    this.idNodeMap.set(id, n);
    this.nodeMetaMap.set(n, meta);
  }

  replace(id: number, n: Node) {
    const oldNode = this.getNode(id);
    if (oldNode) {
      const meta = this.nodeMetaMap.get(oldNode);
      if (meta) this.nodeMetaMap.set(n, meta);
    }
    this.idNodeMap.set(id, n);
  }

  reset() {
    this.idNodeMap = new Map();
    this.nodeMetaMap = new WeakMap();
  }
}

export function createMirror(): Mirror {
  return new Mirror();
}

export function maskInputValue({
  element,
  maskInputOptions,
  tagName,
  type,
  value,
  maskInputFn,
}: {
  element: HTMLElement;
  maskInputOptions: MaskInputOptions;
  tagName: string;
  type: string | null;
  value: string | null;
  maskInputFn?: MaskInputFn;
}): string {
  let text = value || '';
  const actualType = type && toLowerCase(type);

  if (
    maskInputOptions[tagName.toLowerCase() as keyof MaskInputOptions] ||
    (actualType && maskInputOptions[actualType as keyof MaskInputOptions])
  ) {
    if (maskInputFn) {
      text = maskInputFn(text, element);
    } else {
      text = '*'.repeat(text.length);
    }
  }
  return text;
}

export function toLowerCase<T extends string>(str: T): Lowercase<T> {
  return str.toLowerCase() as unknown as Lowercase<T>;
}

// Minimum rrweb-generated layout metadata that must retain its value for replay.
// Unlike source DOM attributes, these values cannot contain application strings.
const RENDERING_METADATA_ATTRIBUTES = new Set([
  'rr_width',
  'rr_height',
  'rr_left',
  'rr_top',
  'rr_position',
  'rr_transform',
  'rr_display',
  'rr_scrollleft',
  'rr_scrolltop',
  'rr_mediastate',
  'rr_open_mode',
]);

export function maskAttributeValue({
  element,
  name,
  value,
  maskAllElementAttributes,
  maskAttributeFn,
  isGenerated = false,
}: {
  element: Element;
  name: string;
  value: string | null;
  maskAllElementAttributes: boolean;
  maskAttributeFn: MaskAttributeFn | undefined;
  isGenerated?: boolean;
}): string | null {
  if (!value) {
    return value;
  }
  // The options are mutually exclusive and the coarse one fails closed: when
  // both are set the callback is never consulted, so it cannot silently
  // unmask values the coarse option would have hidden.
  if (maskAllElementAttributes) {
    return isGenerated && RENDERING_METADATA_ATTRIBUTES.has(toLowerCase(name))
      ? value
      : '*'.repeat(value.length);
  }
  if (maskAttributeFn) {
    return maskAttributeFn(name, value, element);
  }
  return value;
}

const ORIGINAL_ATTRIBUTE_NAME = '__rrweb_original__';
type PatchedGetImageData = {
  [ORIGINAL_ATTRIBUTE_NAME]: CanvasImageData['getImageData'];
} & CanvasImageData['getImageData'];

export function is2DCanvasBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;

  const chunkSize = 50;

  // get chunks of the canvas and check if it is blank
  for (let x = 0; x < canvas.width; x += chunkSize) {
    for (let y = 0; y < canvas.height; y += chunkSize) {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const getImageData = ctx.getImageData as PatchedGetImageData;
      const originalGetImageData =
        ORIGINAL_ATTRIBUTE_NAME in getImageData
          ? getImageData[ORIGINAL_ATTRIBUTE_NAME]
          : getImageData;
      // by getting the canvas in chunks we avoid an expensive
      // `getImageData` call that retrieves everything
      // even if we can already tell from the first chunk(s) that
      // the canvas isn't blank
      const pixelBuffer = new Uint32Array(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
        originalGetImageData.call(
          ctx,
          x,
          y,
          Math.min(chunkSize, canvas.width - x),
          Math.min(chunkSize, canvas.height - y),
        ).data.buffer,
      );
      if (pixelBuffer.some((pixel) => pixel !== 0)) return false;
    }
  }
  return true;
}

export function isNodeMetaEqual(a: serializedNode, b: serializedNode): boolean {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === NodeType.Document)
    return a.compatMode === (b as documentNode).compatMode;
  else if (a.type === NodeType.DocumentType)
    return (
      a.name === (b as documentTypeNode).name &&
      a.publicId === (b as documentTypeNode).publicId &&
      a.systemId === (b as documentTypeNode).systemId
    );
  else if (
    a.type === NodeType.Comment ||
    a.type === NodeType.Text ||
    a.type === NodeType.CDATA
  )
    return a.textContent === (b as textNode).textContent;
  else if (a.type === NodeType.Element)
    return (
      a.tagName === (b as elementNode).tagName &&
      JSON.stringify(a.attributes) ===
        JSON.stringify((b as elementNode).attributes) &&
      a.isSVG === (b as elementNode).isSVG &&
      a.needBlock === (b as elementNode).needBlock
    );
  return false;
}

/**
 * Get the type of an input element.
 * This takes care of the case where a password input is changed to a text input.
 * In this case, we continue to consider this of type password, in order to avoid leaking sensitive data
 * where passwords should be masked.
 */
export function getInputType(element: HTMLElement): Lowercase<string> | null {
  try {
    // when omitting the type of input element(e.g. <input />), the type is treated as text
    const type = (element as HTMLInputElement).type;

    return element.hasAttribute('data-rr-is-password')
      ? 'password'
      : type
      ? // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        toLowerCase(type)
      : null;
  } catch {
    // reading the native `type` accessor / `hasAttribute` on a non-native
    // `this` (a proxy or cross-realm object) throws 'Illegal invocation';
    // treat it as an untyped element rather than letting the error propagate
    return null;
  }
}

/**
 * Extracts the file extension from an a path, considering search parameters and fragments.
 * @param path - Path to file
 * @param baseURL - [optional] Base URL of the page, used to resolve relative paths. Defaults to current page URL.
 */
export function extractFileExtension(
  path: string,
  baseURL?: string,
): string | null {
  let url;
  try {
    url = new URL(path, baseURL ?? window.location.href);
  } catch (err) {
    return null;
  }
  const regex = /\.([0-9a-z]+)(?:$)/i;
  const match = url.pathname.match(regex);
  return match?.[1] ?? null;
}

function extractOrigin(url: string): string {
  let origin = '';
  if (url.indexOf('//') > -1) {
    origin = url.split('/').slice(0, 3).join('/');
  } else {
    origin = url.split('/')[0];
  }
  origin = origin.split('?')[0];
  return origin;
}

const URL_IN_CSS_REF = /url\((?:(')([^']*)'|(")(.*?)"|([^)]*))\)/gm;
const URL_PROTOCOL_MATCH = /^(?:[a-z+]+:)?\/\//i;
const URL_WWW_MATCH = /^www\..*/i;
const DATA_URI = /^(data:)([^,]*),(.*)/i;
export function absolutifyURLs(cssText: string | null, href: string): string {
  // codeql[js/polynomial-redos] Bounded CSS text; worst case is recorder slowdown, no exploit.
  return (cssText || '').replace(
    URL_IN_CSS_REF,
    (
      origin: string,
      quote1: string,
      path1: string,
      quote2: string,
      path2: string,
      path3: string,
    ) => {
      const filePath = path1 || path2 || path3;
      const maybeQuote = quote1 || quote2 || '';
      if (!filePath) {
        return origin;
      }
      if (URL_PROTOCOL_MATCH.test(filePath) || URL_WWW_MATCH.test(filePath)) {
        return `url(${maybeQuote}${filePath}${maybeQuote})`;
      }
      if (DATA_URI.test(filePath)) {
        return `url(${maybeQuote}${filePath}${maybeQuote})`;
      }
      if (filePath[0] === '/') {
        return `url(${maybeQuote}${
          extractOrigin(href) + filePath
        }${maybeQuote})`;
      }
      const stack = href.split('/');
      const parts = filePath.split('/');
      stack.pop();
      for (const part of parts) {
        if (part === '.') {
          continue;
        } else if (part === '..') {
          stack.pop();
        } else {
          stack.push(part);
        }
      }
      return `url(${maybeQuote}${stack.join('/')}${maybeQuote})`;
    },
  );
}

const STRIPED_PLACEHOLDER_SVG =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxkZWZzPgogICAgPHBhdHRlcm4gaWQ9InN0cmlwZXMiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+CiAgICAgIDxyZWN0IHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgZmlsbD0iYmxhY2siLz4KICAgICAgPHBhdGggZD0iTTggMEgxNkwwIDE2VjhMOCAwWiIgZmlsbD0iIzJEMkQyRCIvPgogICAgICA8cGF0aCBkPSJNMTYgOFYxNkg4TDE2IDhaIiBmaWxsPSIjMkQyRDJEIi8+CiAgICA8L3BhdHRlcm4+CiAgPC9kZWZzPgogIDxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjc3RyaXBlcykiLz4KPC9zdmc+Cg==';

const MAX_IMAGE_DIMENSION_FOR_RECOMPRESSION = 4096;
// below this, recompression cannot save enough payload to justify a
// synchronous canvas encode, whose cost scales with pixel count (not bytes)
// and can block the main thread for hundreds of ms per image
const MIN_DATA_URL_LENGTH_FOR_RECOMPRESSION = 100_000;
const MAX_RECOMPRESSION_CACHE_ENTRIES = 10;

type RecompressionCacheEntry = {
  type?: string;
  quality?: number;
  result: string;
};

// full snapshots and attribute mutations serialize the same image repeatedly,
// so each unique data URL should only ever be encoded once
const recompressionCache = new Map<string, RecompressionCacheEntry>();

export function recompressBase64Image(
  img: HTMLImageElement,
  dataURL: string,
  type?: string,
  quality?: number,
): string {
  if (dataURL.length < MIN_DATA_URL_LENGTH_FOR_RECOMPRESSION) {
    return dataURL;
  }

  if (!img.complete || img.naturalWidth === 0) {
    return dataURL;
  }

  // don't recompress very large images to avoid performance issues
  if (
    img.naturalWidth > MAX_IMAGE_DIMENSION_FOR_RECOMPRESSION ||
    img.naturalHeight > MAX_IMAGE_DIMENSION_FOR_RECOMPRESSION
  ) {
    return dataURL;
  }

  const cached = recompressionCache.get(dataURL);
  if (cached && cached.type === type && cached.quality === quality) {
    return cached.result;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      return dataURL;
    }

    ctx.drawImage(img, 0, 0);
    const recompressed = canvas.toDataURL(type || 'image/webp', quality ?? 0.4);
    // re-encoding an already optimized image can produce a larger file
    const result =
      recompressed.length < dataURL.length ? recompressed : dataURL;

    if (recompressionCache.size >= MAX_RECOMPRESSION_CACHE_ENTRIES) {
      // evict only the oldest entry (Map preserves insertion order) so
      // pages with many unique images keep the rest of the cache warm
      const oldestKey = recompressionCache.keys().next().value;
      if (oldestKey !== undefined) {
        recompressionCache.delete(oldestKey);
      }
    }
    recompressionCache.set(dataURL, { type, quality, result });

    return result;
  } catch (err) {
    return dataURL;
  }
}

export function checkDataURLSize(
  dataURL: string,
  maxLength: number | undefined,
): string {
  if (!maxLength || dataURL.length <= maxLength) {
    return dataURL;
  }

  return STRIPED_PLACEHOLDER_SVG;
}
