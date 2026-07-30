/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';

import snapshot from '../src/snapshot';
import {
  getLastSnapshotCost,
  getMutationCost,
  recordMutationCost,
  resetSnapshotCostState,
  safeCssRuleCount,
  takeDeferredStylesheetLinks,
} from '../src/snapshot-cost';
import { Mirror } from '../src/utils';
import type { elementNode, serializedNodeWithId } from '../src/types';

/**
 * jsdom's `cssRules` are cheap, so we fake sheets whose `cssText` access burns
 * wall-clock. That's the shape of the problem in Chrome: cost is paid per CSSRule,
 * inside `stringifyStylesheet`.
 */
function makeSheet(href: string | null, ruleCount: number, costMsPerRule = 0) {
  const rules = Array.from({ length: ruleCount }, (_, i) => ({
    get cssText() {
      const until = Date.now() + costMsPerRule;
      while (Date.now() < until) {
        /* burn */
      }
      return `.rule-${i} { color: red }`;
    },
  })) as unknown as CSSRule[];
  return { href, cssRules: rules } as unknown as CSSStyleSheet;
}

function appendLink(
  href: string,
  sheet: CSSStyleSheet | null,
): HTMLLinkElement {
  const link = document.createElement('link');
  link.setAttribute('rel', 'stylesheet');
  link.setAttribute('href', href);
  Object.defineProperty(link, 'sheet', {
    configurable: true,
    get: () => sheet,
  });
  document.head.appendChild(link);
  return link;
}

function findByTag(node: serializedNodeWithId, tagName: string): elementNode[] {
  const found: elementNode[] = [];
  const walk = (current: serializedNodeWithId) => {
    if ((current as elementNode).tagName === tagName) {
      found.push(current as unknown as elementNode);
    }
    const children = (current as unknown as { childNodes?: unknown[] })
      .childNodes;
    if (children) {
      for (const child of children) {
        walk(child as serializedNodeWithId);
      }
    }
  };
  walk(node);
  return found;
}

const takeSnapshot = (inlineStylesheetBudgetRules?: number) =>
  snapshot(document, { mirror: new Mirror(), inlineStylesheetBudgetRules });

describe('snapshot cost accounting', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    resetSnapshotCostState();
    takeDeferredStylesheetLinks();
  });

  it('reports duration, node count and stylesheet breakdown for a snapshot', () => {
    document.body.innerHTML = '<div><span>hello</span></div>';
    appendLink('/a.css', makeSheet('http://localhost/a.css', 3, 5));

    takeSnapshot();

    const cost = getLastSnapshotCost();
    expect(cost).not.toBeNull();
    expect(cost!.nodeCount).toBeGreaterThan(5);
    expect(cost!.cssRuleCount).toBe(3);
    expect(cost!.stylesheetMs).toBeGreaterThanOrEqual(10);
    expect(cost!.durationMs).toBeGreaterThanOrEqual(cost!.stylesheetMs);
    expect(cost!.deferredStylesheetCount).toBe(0);
  });

  it('inlines every stylesheet when no budget is set', () => {
    appendLink('/a.css', makeSheet('http://localhost/a.css', 500));
    appendLink('/b.css', makeSheet('http://localhost/b.css', 500));

    const sn = takeSnapshot();

    const links = findByTag(sn!, 'link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.attributes._cssText).toBeDefined();
      expect(link.attributes.href).toBeUndefined();
    }
    expect(takeDeferredStylesheetLinks()).toHaveLength(0);
  });

  it('defers stylesheets past the budget, keeping href so replay can still load them', () => {
    appendLink('/a.css', makeSheet('http://localhost/a.css', 8));
    const second = appendLink('/b.css', makeSheet('http://localhost/b.css', 8));
    const third = appendLink('/c.css', makeSheet('http://localhost/c.css', 8));

    const sn = takeSnapshot(10);

    const links = findByTag(sn!, 'link');
    expect(links).toHaveLength(3);
    expect(links[0].attributes._cssText).toBeDefined();
    expect(links[1].attributes._cssText).toBeUndefined();
    expect(links[1].attributes.href).toBe('http://localhost/b.css');
    expect(links[2].attributes._cssText).toBeUndefined();

    expect(getLastSnapshotCost()!.deferredStylesheetCount).toBe(2);
    expect(takeDeferredStylesheetLinks()).toEqual([second, third]);
  });

  it('defers a single sheet that alone would blow the budget', () => {
    // the whole point of budgeting by rule count: a per-sheet-atomic time budget
    // could only ever stop the *next* sheet, so this shape would slip through it
    const only = appendLink(
      '/big.css',
      makeSheet('http://localhost/big.css', 50),
    );

    const sn = takeSnapshot(10);

    const links = findByTag(sn!, 'link');
    expect(links[0].attributes._cssText).toBeUndefined();
    expect(links[0].attributes.href).toBe('http://localhost/big.css');
    expect(getLastSnapshotCost()!.stylesheetMs).toBe(0);
    expect(takeDeferredStylesheetLinks()).toEqual([only]);
  });

  it('leaves <style> textContent intact when the budget is spent', () => {
    appendLink('/a.css', makeSheet('http://localhost/a.css', 20));
    const style = document.createElement('style');
    style.appendChild(document.createTextNode('.from-text { color: blue }'));
    Object.defineProperty(style, 'sheet', {
      configurable: true,
      get: () => makeSheet(null, 20),
    });
    document.head.appendChild(style);

    const sn = takeSnapshot(10);

    const styles = findByTag(sn!, 'style');
    const text = (
      styles[0] as unknown as { childNodes: { textContent: string }[] }
    ).childNodes[0];
    expect(text.textContent).toContain('.from-text');
  });

  it('does not apply a budget outside a snapshot, so mutations stay unbounded', () => {
    // the incremental path never opens a tracking scope, so nothing is ever deferred
    appendLink('/a.css', makeSheet('http://localhost/a.css', 5000));
    expect(takeDeferredStylesheetLinks()).toHaveLength(0);
  });

  describe('safeCssRuleCount', () => {
    it('counts nested rules of grouping and @import rules', () => {
      // an @media block is one CSSRule however many rules it holds - counting only
      // the top level would make a media-query-organised framework look free
      const sheet = {
        cssRules: [
          { cssText: '.a {}' },
          { cssRules: { length: 40 } },
          { styleSheet: { cssRules: { length: 25 } } },
        ],
      } as unknown as CSSStyleSheet;

      expect(safeCssRuleCount(sheet)).toBe(3 + 40 + 25);
    });

    it('returns 0 for unreadable sheets', () => {
      const crossOrigin = {
        get cssRules(): CSSRuleList {
          throw new Error('SecurityError');
        },
      } as unknown as CSSStyleSheet;

      expect(safeCssRuleCount(crossOrigin)).toBe(0);
      expect(safeCssRuleCount(null)).toBe(0);
      expect(safeCssRuleCount(undefined)).toBe(0);
    });
  });

  it('tracks the slowest mutation batch', () => {
    recordMutationCost(12);
    recordMutationCost(40);
    recordMutationCost(3);

    expect(getMutationCost()).toEqual({ totalMs: 55, slowestBatchMs: 40 });

    resetSnapshotCostState();
    expect(getMutationCost()).toEqual({ totalMs: 0, slowestBatchMs: 0 });
  });
});
