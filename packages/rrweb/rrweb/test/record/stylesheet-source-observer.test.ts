import { afterEach, describe, expect, it } from 'vitest';
import {
  stringifyRule,
  rememberStyleRuleSource,
  exposeStyleRuleSource,
} from '@posthog/rrweb-snapshot';
import type { IWindow } from '@posthog/rrweb-types';
import {
  StyleRuleSourceSession,
  registerStyleRuleSourceSession,
  withStyleRuleSourceHandoff,
} from '../../src/record/stylesheet-source-observer';

const text = '.card { padding: var(--p); padding-left: 12px; }';
const sessions: StyleRuleSourceSession[] = [];
function realm() {
  const prototype = {};
  const win = {
    CSSRule: { prototype },
    document: { readyState: 'complete' },
  } as unknown as IWindow;
  const rule = Object.assign(Object.create(prototype), {
    cssText: '.card { padding-top: ; padding-left: 12px; }',
    parentRule: null,
  }) as CSSRule;
  return { win, rule };
}
function start(win: IWindow) {
  const session = new StyleRuleSourceSession(win, true);
  sessions.push(session);
  session.ready = true;
  const stop = () => {
    session.beforeStop();
    session.stop();
  };
  registerStyleRuleSourceSession(stop, session);
  return { session, stop };
}
afterEach(() => {
  for (const session of sessions) session.stop();
  sessions.length = 0;
});

describe('stylesheet source handoff ownership', () => {
  it.each([false, true])(
    'rejects late source writes after stop; abandoned handoff: %s',
    (abandon) => {
      const { win, rule } = realm();
      const { stop } = start(win);
      rememberStyleRuleSource(rule, text);
      expect(stringifyRule(rule, null)).toBe(text);
      if (abandon) withStyleRuleSourceHandoff(stop, () => stop());
      else stop();
      rememberStyleRuleSource(rule, text);
      expect(stringifyRule(rule, null)).toBe(rule.cssText);
    },
  );

  it('restores partially installed guards if realm setup throws', () => {
    const { win } = realm();
    const original = () => ({});
    const prototype = Object.create(win.CSSRule.prototype);
    Object.defineProperty(prototype, 'style', {
      configurable: true,
      get: original,
    });
    Object.assign(win, { CSSStyleRule: { prototype } });
    Object.defineProperty(win, 'CSSKeyframesRule', {
      get: () => {
        throw new Error('unavailable constructor');
      },
    });
    expect(() => start(win)).toThrow('unavailable constructor');
    expect(Object.getOwnPropertyDescriptor(prototype, 'style')!.get).toBe(
      original,
    );
  });

  it('preserves mutable-handle tombstones across a handoff', () => {
    const { win, rule } = realm();
    const { stop } = start(win);
    exposeStyleRuleSource(rule);
    withStyleRuleSourceHandoff(stop, () => {
      stop();
      start(win);
      rememberStyleRuleSource(rule, text);
      expect(stringifyRule(rule, null)).toBe(rule.cssText);
    });
  });

  it('expires an unclaimed iframe source without clearing the parent source', () => {
    const parent = realm();
    const child = realm();
    const frame = { isConnected: true };
    Object.assign(child.win, { frameElement: frame });
    const { session, stop } = start(parent.win);
    session.observe(child.win);
    rememberStyleRuleSource(parent.rule, text);
    rememberStyleRuleSource(child.rule, text);
    withStyleRuleSourceHandoff(stop, () => {
      stop();
      const next = start(parent.win);
      frame.isConnected = false;
      next.session.prune();
      expect(stringifyRule(child.rule, null)).toBe(child.rule.cssText);
      expect(stringifyRule(parent.rule, null)).toBe(text);
    });
  });
});
