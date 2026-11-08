import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getStyleRuleSource,
  exposeStyleRuleSource,
  disableStyleRuleSources,
  invalidateStyleRuleSource,
  rememberStyleRuleSource,
  rememberStylesheetSource,
  resetStyleRuleSources,
} from '../src/stylesheet-source';
import { stringifyRule } from '../src/utils';

const corrupted =
  '.card { padding-top: ; padding-right: ; padding-bottom: ; padding-left: 12px; }';
const authored = '.card { padding: var(--p); padding-left: 12px; }';
const rule = (cssText = corrupted, parentRule: CSSRule | null = null) =>
  ({ cssText, parentRule, selectorText: '.card', type: 1 }) as CSSStyleRule;
const sheet = (...rules: CSSRule[]) =>
  ({ cssRules: rules }) as unknown as CSSStyleSheet;

beforeEach(resetStyleRuleSources);

describe('stylesheet source retention', () => {
  it.each([
    authored,
    '/* braces { ; } */ ' + authored,
    '.card { padding: var(--p); padding-left: 12px; content: "};{\\\""; }',
    '.card { padding: var(--p); padding-left: 12px; background: url("data:image/svg+xml,<svg>{;}</svg>"); }',
    '.card { padding: var(--p); padding-left: 12px; --tokens: { a: b; }; }',
    '.\\{card\\} { padding: var(--p); padding-left: 12px; }',
    '@media (min-width: 0px) { ' + authored + ' }',
  ])(
    'retains a complete rule without splitting its strings or nested blocks: %s',
    (text) => {
      const first = rule();
      const second = rule('.second { color: red; }');
      rememberStylesheetSource(
        sheet(first, second),
        text + '\n.second { color: red; } /* trailing comment */',
      );
      expect(getStyleRuleSource(first)).toBe(text);
      expect(getStyleRuleSource(second)).toBeUndefined();
      expect(stringifyRule(first, null)).toBe(text);
    },
  );

  it('keeps semicolon-terminated at-rules paired with the right rule', () => {
    const layer = rule('@layer theme;');
    const style = rule();
    rememberStylesheetSource(sheet(layer, style), '@layer theme;' + authored);
    expect(getStyleRuleSource(layer)).toBeUndefined();
    expect(getStyleRuleSource(style)).toBe(authored);
  });

  it('does not pair source with rules discarded by the native parser', () => {
    const style = rule();
    rememberStylesheetSource(sheet(style), '@import "ignored.css";' + authored);
    expect(getStyleRuleSource(style)).toBeUndefined();
  });

  it('does not reuse source after an observable CSSOM change', () => {
    const style = rule();
    rememberStyleRuleSource(style, authored);
    style.cssText = '.card { color: red; }';
    expect(stringifyRule(style, null)).toBe('.card { color: red; }');
    style.cssText = corrupted;
    expect(getStyleRuleSource(style)).toBeUndefined();
  });

  it('invalidates the rule and its containing source when declarations change', () => {
    const parent = rule();
    const child = rule(corrupted, parent);
    rememberStyleRuleSource(child, authored);
    rememberStyleRuleSource(parent, '@media all {' + authored + '}');
    invalidateStyleRuleSource(child);
    expect(getStyleRuleSource(child)).toBeUndefined();
    expect(getStyleRuleSource(parent)).toBeUndefined();
  });

  it('does not retain source for a declaration handle already exposed to the application', () => {
    const style = rule();
    exposeStyleRuleSource(style);
    rememberStyleRuleSource(style, authored);
    expect(getStyleRuleSource(style)).toBeUndefined();
  });

  it('discards source when mutable declaration access cannot be observed', () => {
    const style = rule();
    rememberStyleRuleSource(style, authored);
    disableStyleRuleSources();
    rememberStyleRuleSource(style, authored);
    expect(getStyleRuleSource(style)).toBeUndefined();
  });

  it('contains restricted rule metadata without changing a native declaration access', () => {
    const style = rule();
    rememberStyleRuleSource(style, authored);
    const restricted = {
      get parentRule() {
        throw new Error('restricted');
      },
    } as CSSRule;
    expect(() => exposeStyleRuleSource(restricted)).not.toThrow();
    expect(getStyleRuleSource(style)).toBeUndefined();
  });

  it('forgets source when observation stops', () => {
    const style = rule();
    rememberStyleRuleSource(style, authored);
    resetStyleRuleSources();
    expect(getStyleRuleSource(style)).toBeUndefined();
  });

  it('does not synchronously read a retained link grouping rule', () => {
    const cssText = vi.fn(() => corrupted);
    const group = {
      get cssText() {
        return cssText();
      },
      cssRules: [rule()],
      parentRule: null,
      parentStyleSheet: { ownerNode: { nodeName: 'LINK' } },
    } as unknown as CSSRule;
    rememberStyleRuleSource(group, '@media all {' + authored + '}');
    expect(cssText).not.toHaveBeenCalled();
    expect(getStyleRuleSource(group)).toBeUndefined();
  });

  it('does not coerce native CSSOM arguments a second time', () => {
    const toString = vi.fn(() => authored);
    expect(() =>
      rememberStylesheetSource(sheet(rule()), {
        toString,
      } as unknown as string),
    ).not.toThrow();
    expect(toString).not.toHaveBeenCalled();
  });

  it('contains unavailable CSSOM reads after a successful native write', () => {
    const inaccessible = {
      get cssRules() {
        throw new Error('restricted');
      },
    } as unknown as CSSStyleSheet;
    expect(() =>
      rememberStylesheetSource(inaccessible, authored),
    ).not.toThrow();
  });
});
