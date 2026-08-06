/**
 * @vitest-environment jsdom
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import snapshot, {
  snapshotWithBudget,
  cleanupSnapshot,
  createYielder,
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

  it('keeps yielding when the page becomes hidden mid-walk', async () => {
    const doc = buildDocument(60);
    let visibility = 'visible';
    Object.defineProperty(doc, 'visibilityState', {
      get: () => visibility,
      configurable: true,
    });

    cleanupSnapshot();
    let yields = 0;
    const node = await snapshotWithBudget(doc, {
      ...OPTIONS,
      mirror: new Mirror(),
      yieldBudgetMs: 0.0001,
      yieldFn: async () => {
        yields++;
        if (yields === 1) {
          // an ordinary tab switch 300ms into the walk
          visibility = 'hidden';
        }
      },
    });

    expect(node).not.toBeNull();
    // the tab switch must not trigger the one-task drain reserved for walks
    // that START hidden: the walk keeps slicing under its own scheduling
    expect(yields).toBeGreaterThan(2);
  });

  it('a throwing serializer during the synchronous drain aborts instead of resuming truncated', async () => {
    const doc = buildDocument(60);

    cleanupSnapshot();
    let blowUp = false;
    let controller: BudgetedSnapshotController | null = null;
    const walkPromise = snapshotWithBudget(doc, {
      ...OPTIONS,
      maskTextSelector: 'td',
      maskTextFn: (text: string) => {
        if (blowUp) {
          throw new Error('mask exploded');
        }
        return text;
      },
      mirror: new Mirror(),
      yieldBudgetMs: 0.0001,
      yieldFn: () => new Promise<void>(() => undefined),
      onController: (c) => {
        controller = c;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    blowUp = true;
    // the drain dies mid-serialization with a node already popped
    expect(controller!.flushSync()).toBeNull();
    // the driver must not resume from the damaged stack and emit a
    // truncated tree: the walk fails, loudly
    await expect(walkPromise).rejects.toThrow('mask exploded');
    expect(controller!.flushSync()).toBeNull();
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

  it('the watchdog expires a walk parked on a yield that never settles', async () => {
    const doc = buildDocument(120);

    cleanupSnapshot();
    // nothing else touches this walk: without the timer waking the driver,
    // this promise would simply never settle
    await expect(
      snapshotWithBudget(doc, {
        ...OPTIONS,
        mirror: new Mirror(),
        yieldBudgetMs: 0.0001,
        maxWalkWallClockMs: 30,
        yieldFn: () => new Promise<void>(() => undefined),
      }),
    ).rejects.toThrow('wall-clock');
  });

  it('flushSync wakes the parked driver so the walk promise settles on its own', async () => {
    const doc = buildDocument(60);

    cleanupSnapshot();
    let controller: BudgetedSnapshotController | null = null;
    const walkPromise = snapshotWithBudget(doc, {
      ...OPTIONS,
      mirror: new Mirror(),
      yieldBudgetMs: 0.0001,
      yieldFn: () => new Promise<void>(() => undefined),
      onController: (c) => {
        controller = c;
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const root = controller!.flushSync();
    expect(root).not.toBeNull();
    // no external help: flushSync itself must release the parked driver, or
    // the yielder and this promise are retained for the life of the page
    await expect(walkPromise).resolves.toBe(root);
  });

  it('createYielder dispose settles a parked yield', async () => {
    const yielder = createYielder();
    const parked = yielder.doYield();
    yielder.dispose();
    await expect(parked).resolves.toBeUndefined();
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

  it('getStats reports the slice telemetry of a completed walk', async () => {
    const doc = buildDocument(60);

    cleanupSnapshot();
    let controller: BudgetedSnapshotController | null = null;
    let yields = 0;
    const node = await snapshotWithBudget(doc, {
      ...OPTIONS,
      mirror: new Mirror(),
      yieldBudgetMs: 0.0001,
      yieldFn: async () => {
        yields++;
      },
      onController: (c) => {
        controller = c;
      },
    });

    expect(node).not.toBeNull();
    const stats = controller!.getStats();
    // one work window per yield plus the final one
    expect(stats.sliceCount).toBe(yields + 1);
    expect(stats.sliceCount).toBeGreaterThanOrEqual(2);
    expect(stats.longestSliceMs).toBeGreaterThan(0);
  });

  it('a flushSync drain counts as a work window in the stats', async () => {
    const doc = buildDocument(60);

    cleanupSnapshot();
    let controller: BudgetedSnapshotController | null = null;
    const walkPromise = snapshotWithBudget(doc, {
      ...OPTIONS,
      mirror: new Mirror(),
      yieldBudgetMs: 0.0001,
      yieldFn: () => new Promise<void>(() => undefined),
      onController: (c) => {
        controller = c;
      },
    });
    // let the walk reach its first yield and park
    await new Promise((resolve) => setTimeout(resolve, 10));

    const before = controller!.getStats();
    expect(before.sliceCount).toBeGreaterThanOrEqual(1);
    const root = controller!.flushSync();
    expect(root).not.toBeNull();
    const after = controller!.getStats();
    expect(after.sliceCount).toBe(before.sliceCount + 1);
    expect(after.longestSliceMs).toBeGreaterThanOrEqual(before.longestSliceMs);
    await expect(walkPromise).resolves.toBe(root);
  });
});
