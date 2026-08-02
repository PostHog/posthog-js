/**
 * @vitest-environment jsdom
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import snapshot, {
  snapshotWithBudget,
  cleanupSnapshot,
  type BudgetedSnapshotController,
} from '../src/snapshot';
import type { serializedNodeWithId } from '../src/types';
import { Mirror } from '../src/utils';

function buildDocument(rows = 60): Document {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head><title>hardening</title></head><body>
      <div id="app"><table><tbody></tbody></table></div>
    </body></html>`,
    { url: 'https://example.com/page' },
  );
  const doc = dom.window.document;
  const tbody = doc.querySelector('tbody')!;
  for (let r = 0; r < rows; r++) {
    const tr = doc.createElement('tr');
    for (let c = 0; c < 5; c++) {
      const td = doc.createElement('td');
      td.textContent = `cell-${r}-${c}`;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  return doc;
}

const OPTIONS = {
  blockClass: 'blockblock',
  blockSelector: null,
  maskTextClass: 'maskmask',
  maskTextSelector: null,
  inlineStylesheet: true,
};

function collectTexts(node: serializedNodeWithId | null): string[] {
  if (!node) return [];
  const texts: string[] = [];
  const walk = (n: serializedNodeWithId) => {
    if ('textContent' in n && typeof n.textContent === 'string') {
      texts.push(n.textContent);
    }
    if ('childNodes' in n) {
      for (const child of n.childNodes) walk(child);
    }
  };
  walk(node);
  return texts;
}

describe('snapshotWithBudget hardening', () => {
  it('shouldSkipNode leaves the node and its entire subtree out of the output', async () => {
    const doc = buildDocument(10);
    const skipRoot = doc.createElement('section');
    skipRoot.id = 'skip-me';
    const skipChild = doc.createElement('p');
    skipChild.textContent = 'skipped-child-text';
    skipRoot.appendChild(skipChild);
    doc.body.appendChild(skipRoot);

    cleanupSnapshot();
    const node = await snapshotWithBudget(doc, {
      ...OPTIONS,
      mirror: new Mirror(),
      yieldBudgetMs: 60_000,
      yieldFn: async () => undefined,
      shouldSkipNode: (n) =>
        (n as Element).nodeType === 1 && (n as Element).id === 'skip-me',
    });

    expect(node).not.toBeNull();
    const texts = collectTexts(node);
    expect(texts).not.toContain('skipped-child-text');
    expect(JSON.stringify(node)).not.toContain('skip-me');
    // unrelated content still present
    expect(texts).toContain('cell-0-0');
  });

  it('flushSync drains a parked walk synchronously and returns the full tree', async () => {
    const doc = buildDocument(60);

    cleanupSnapshot();
    const syncNode = snapshot(doc, { ...OPTIONS, mirror: new Mirror() });

    cleanupSnapshot();
    let controller: BudgetedSnapshotController | null = null;
    // a yield that never resolves parks the async driver for good — the
    // pagehide situation
    const walkPromise = snapshotWithBudget(doc, {
      ...OPTIONS,
      mirror: new Mirror(),
      yieldBudgetMs: 0.0001,
      yieldFn: () => new Promise<void>(() => undefined),
      onController: (c) => {
        controller = c;
      },
    });
    // let the walk reach its first yield
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(controller).not.toBeNull();
    const root = controller!.flushSync();
    expect(root).not.toBeNull();
    expect(JSON.parse(JSON.stringify(root))).toEqual(
      JSON.parse(JSON.stringify(syncNode)),
    );
    // a second call is an idempotent no-op returning the same tree
    expect(controller!.flushSync()).toBe(root);
    void walkPromise; // parked forever by design; the caller uses the return value
  });

  it('the async driver resolves with the flushSync tree when its yield later fires', async () => {
    const doc = buildDocument(30);

    cleanupSnapshot();
    let controller: BudgetedSnapshotController | null = null;
    let releaseYield: (() => void) | null = null;
    const walkPromise = snapshotWithBudget(doc, {
      ...OPTIONS,
      mirror: new Mirror(),
      yieldBudgetMs: 0.0001,
      yieldFn: () =>
        new Promise<void>((resolve) => {
          releaseYield = resolve;
        }),
      onController: (c) => {
        controller = c;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const root = controller!.flushSync();
    expect(root).not.toBeNull();
    releaseYield!();
    await expect(walkPromise).resolves.toBe(root);
  });

  it('flushSync respects shouldAbort and returns null', async () => {
    const doc = buildDocument(30);

    cleanupSnapshot();
    let controller: BudgetedSnapshotController | null = null;
    let aborted = false;
    const walkPromise = snapshotWithBudget(doc, {
      ...OPTIONS,
      mirror: new Mirror(),
      yieldBudgetMs: 0.0001,
      yieldFn: () => new Promise<void>(() => undefined),
      shouldAbort: () => aborted,
      onController: (c) => {
        controller = c;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    aborted = true;
    expect(controller!.flushSync()).toBeNull();
    void walkPromise;
  });

  it('completes in a single slice while the document is hidden', async () => {
    const doc = buildDocument(60);
    Object.defineProperty(doc, 'visibilityState', {
      get: () => 'hidden',
      configurable: true,
    });

    cleanupSnapshot();
    const syncNode = snapshot(doc, { ...OPTIONS, mirror: new Mirror() });

    cleanupSnapshot();
    let yields = 0;
    const node = await snapshotWithBudget(doc, {
      ...OPTIONS,
      mirror: new Mirror(),
      yieldBudgetMs: 0.0001,
      yieldFn: async () => {
        yields++;
      },
    });

    expect(yields).toBe(0);
    expect(JSON.parse(JSON.stringify(node))).toEqual(
      JSON.parse(JSON.stringify(syncNode)),
    );
  });

  it('rejects once the wall-clock watchdog trips', async () => {
    const doc = buildDocument(120);

    cleanupSnapshot();
    await expect(
      snapshotWithBudget(doc, {
        ...OPTIONS,
        mirror: new Mirror(),
        yieldBudgetMs: 0.0001,
        maxWalkWallClockMs: 0,
        yieldFn: async () => undefined,
      }),
    ).rejects.toThrow('wall-clock');
  });

  it('reports whether a <style> text serialization inlined the live CSSOM', async () => {
    const dom = new JSDOM(
      `<!DOCTYPE html><html><head>
        <style id="single">.a { color: red; }</style>
        <style id="siblings">.b { color: blue; }</style>
      </head><body><div>content</div></body></html>`,
      { url: 'https://example.com/page' },
    );
    const doc = dom.window.document;
    // a second text node makes cssRules unattributable — raw text is kept
    const siblings = doc.getElementById('siblings')!;
    siblings.appendChild(doc.createTextNode('.c { color: green; }'));
    // a rule inserted via CSSOM exists only in cssRules, not the author text
    const single = doc.getElementById('single') as HTMLStyleElement;
    single.sheet!.insertRule('.inserted { color: purple; }', 1);

    cleanupSnapshot();
    const reports: Array<{ parentId: string; inlined: boolean }> = [];
    await snapshotWithBudget(doc, {
      ...OPTIONS,
      mirror: new Mirror(),
      yieldBudgetMs: 60_000,
      yieldFn: async () => undefined,
      onStylesheetTextSerialized: (textNode, inlined) => {
        reports.push({
          parentId: (textNode.parentNode as Element).id,
          inlined,
        });
      },
    });

    const single_ = reports.find((r) => r.parentId === 'single');
    const siblings_ = reports.filter((r) => r.parentId === 'siblings');
    expect(single_?.inlined).toBe(true);
    expect(siblings_.length).toBeGreaterThan(0);
    for (const report of siblings_) {
      expect(report.inlined).toBe(false);
    }
  });
});
