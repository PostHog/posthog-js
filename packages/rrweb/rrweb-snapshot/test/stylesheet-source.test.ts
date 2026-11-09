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
import { createStylesheetTextCursor, stringifyRule } from '../src/utils';

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
    '.card { padding: var(--p); padding-left: 12px; content: "<!-- -->"; --tokens: <!-- -->; }',
    '.parent--> .card { padding: var(--p); padding-left: 12px; }',
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

  it.each(['<!--', '-->', '/* prefix */ <!-- -->'])(
    'discards stylesheet-only tokens before a retained rule: %s',
    (prefix) => {
      const style = rule();
      rememberStylesheetSource(sheet(style), prefix + authored + '-->');
      expect(getStyleRuleSource(style)).toBe(authored);
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

  it.each([1, 2])(
    'keeps grouping-rule serialization bounded through %s linked imports',
    (depth) => {
      let childReads = 0;
      const children = Array.from({ length: 50 }, (_, index) => ({
        get cssText() {
          childReads++;
          return index === 0 ? corrupted : `.item-${index} { color: red; }`;
        },
      }));
      const group = {
        cssRules: children,
        media: { mediaText: 'all' },
        parentRule: null,
        get cssText() {
          return (
            '@media all {' +
            children.map((child) => child.cssText).join('') +
            '}'
          );
        },
      } as unknown as CSSRule;
      let current = sheet(group);
      Object.defineProperty(group, 'parentStyleSheet', { value: current });
      for (let index = 0; index < depth; index++) {
        const parent = sheet();
        const imported = {
          styleSheet: current,
          parentStyleSheet: parent,
          media: { mediaText: '' },
        } as CSSImportRule;
        Object.defineProperty(parent, 'cssRules', { value: [imported] });
        Object.defineProperty(current, 'ownerRule', { value: imported });
        current = parent;
      }
      Object.defineProperty(current, 'ownerNode', {
        value: { nodeName: 'LINK' },
      });
      rememberStyleRuleSource(
        group,
        '@media all {' +
          children
            .map((_, index) =>
              index === 0 ? authored : `.item-${index} { color: red; }`,
            )
            .join('') +
          '}',
      );
      childReads = 0;
      const cursor = createStylesheetTextCursor(current);
      let maxReads = 0;
      for (;;) {
        const before = childReads;
        const done = cursor.advance(1);
        maxReads = Math.max(maxReads, childReads - before);
        if (done) break;
      }
      expect(maxReads).toBeLessThanOrEqual(1);
      expect(childReads).toBe(50);
      expect(cursor.text()).toContain('.item-49 { color: red; }');
    },
  );

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
