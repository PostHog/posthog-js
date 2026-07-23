/**
 * @vitest-environment jsdom
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import snapshot, {
  snapshotWithBudget,
  cleanupSnapshot,
} from '../src/snapshot';
import type { serializedNodeWithId } from '../src/types';
import { Mirror } from '../src/utils';

/**
 * Builds a document exercising every branch the budgeted walker has to
 * mirror: blocked subtrees (children must get NO ids), textarea value
 * semantics, masked text, slimDOM comment/head-whitespace exclusion
 * (IGNORED_NODE path), shadow DOM (light-then-shadow ordering + isShadow
 * flags), form state via properties, SVG, and plain deep nesting.
 */
function buildRichDocument(): Document {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head>
      <style>.rule { color: red; }</style>
      <!-- a comment that slimDOM will drop -->
      <title>budget test</title>
    </head><body>
      <div id="app">
        <div class="blockblock" style="width:10px;height:10px"><b>secret-1</b><b>secret-2</b><i>secret-3</i></div>
        <p class="maskmask">sensitive text to mask</p>
        <pre>   preserved   whitespace   </pre>
        <svg viewBox="0 0 10 10"><g><rect x="1" y="1"></rect><circle r="2"></circle></g></svg>
        <textarea>seed-content</textarea>
        <form></form>
        <table><tbody></tbody></table>
      </div>
    </body></html>`,
    { url: 'https://example.com/page' },
  );
  const doc = dom.window.document;

  // deep nested table so the walk has real breadth/depth
  const tbody = doc.querySelector('tbody')!;
  for (let r = 0; r < 40; r++) {
    const tr = doc.createElement('tr');
    for (let c = 0; c < 5; c++) {
      const td = doc.createElement('td');
      const span = doc.createElement('span');
      span.textContent = `cell-${r}-${c}`;
      td.appendChild(span);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  // form state living in properties, not attributes
  const form = doc.querySelector('form')!;
  for (let i = 0; i < 10; i++) {
    const input = doc.createElement('input');
    input.type = 'text';
    input.value = `typed-${i}`;
    form.appendChild(input);
  }
  const checkbox = doc.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = true;
  form.appendChild(checkbox);
  const textarea = doc.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = 'typed-over-seed'; // value wins; child text node must be dropped

  // shadow DOM: host with light children AND shadow children
  const host = doc.createElement('div');
  host.id = 'shadow-host';
  const light = doc.createElement('em');
  light.textContent = 'light-child';
  host.appendChild(light);
  const shadowRoot = host.attachShadow({ mode: 'open' });
  for (let i = 0; i < 5; i++) {
    const p = doc.createElement('p');
    const span = doc.createElement('span');
    span.textContent = `shadow-${i}`;
    p.appendChild(span);
    shadowRoot.appendChild(p);
  }
  doc.getElementById('app')!.appendChild(host);

  return doc;
}

const SNAPSHOT_OPTIONS = {
  blockClass: 'blockblock',
  blockSelector: null,
  maskTextClass: 'maskmask',
  maskTextSelector: null,
  inlineStylesheet: true,
  maskAllInputs: true as const,
  slimDOM: { comment: true, headWhitespace: true },
};

function countNodes(node: serializedNodeWithId | null): number {
  if (!node) return 0;
  let count = 1;
  if ('childNodes' in node) {
    for (const child of node.childNodes) count += countNodes(child);
  }
  return count;
}

describe('snapshotWithBudget', () => {
  it('produces output deep-equal to the synchronous snapshot, while yielding', async () => {
    const doc = buildRichDocument();

    cleanupSnapshot(); // ids start at 1
    const syncNode = snapshot(doc, {
      ...SNAPSHOT_OPTIONS,
      mirror: new Mirror(),
    });

    cleanupSnapshot(); // same starting id for the budgeted run
    let yields = 0;
    const budgetedNode = await snapshotWithBudget(doc, {
      ...SNAPSHOT_OPTIONS,
      mirror: new Mirror(),
      // sub-ms budget forces a yield on essentially every node — the
      // maximally-interleaved case
      yieldBudgetMs: 0.0001,
      yieldFn: async () => {
        yields++;
      },
    });

    expect(syncNode).not.toBeNull();
    expect(budgetedNode).not.toBeNull();
    expect(countNodes(budgetedNode)).toEqual(countNodes(syncNode));
    // absolute ids included: same pre-order, same exclusions, same flags
    expect(JSON.parse(JSON.stringify(budgetedNode))).toEqual(
      JSON.parse(JSON.stringify(syncNode)),
    );
    expect(yields).toBeGreaterThan(10);
  });

  it('with a large budget completes without yielding and stays equivalent', async () => {
    const doc = buildRichDocument();

    cleanupSnapshot();
    const syncNode = snapshot(doc, {
      ...SNAPSHOT_OPTIONS,
      mirror: new Mirror(),
    });

    cleanupSnapshot();
    let yields = 0;
    const budgetedNode = await snapshotWithBudget(doc, {
      ...SNAPSHOT_OPTIONS,
      mirror: new Mirror(),
      yieldBudgetMs: 60_000,
      yieldFn: async () => {
        yields++;
      },
    });

    expect(yields).toBe(0);
    expect(JSON.parse(JSON.stringify(budgetedNode))).toEqual(
      JSON.parse(JSON.stringify(syncNode)),
    );
  });

  it('registers the same nodes in the mirror (blocked children excluded)', async () => {
    const doc = buildRichDocument();

    cleanupSnapshot();
    const syncMirror = new Mirror();
    snapshot(doc, { ...SNAPSHOT_OPTIONS, mirror: syncMirror });

    cleanupSnapshot();
    const budgetedMirror = new Mirror();
    await snapshotWithBudget(doc, {
      ...SNAPSHOT_OPTIONS,
      mirror: budgetedMirror,
      yieldBudgetMs: 0.0001,
    });

    // blocked subtree: element itself tracked, children not serialized
    const blocked = doc.querySelector('.blockblock')!;
    expect(budgetedMirror.getId(blocked)).toEqual(syncMirror.getId(blocked));
    expect(budgetedMirror.getId(blocked)).toBeGreaterThan(0);
    for (const child of Array.from(blocked.children)) {
      expect(budgetedMirror.getId(child)).toEqual(syncMirror.getId(child));
      expect(budgetedMirror.getId(child)).toBe(-1); // never serialized
    }

    // spot-check id parity on live nodes across the document
    for (const el of Array.from(doc.querySelectorAll('*')).filter(
      (_, i) => i % 7 === 0,
    )) {
      expect(budgetedMirror.getId(el)).toEqual(syncMirror.getId(el));
    }
    // shadow content ids match too
    const host = doc.getElementById('shadow-host')!;
    for (const child of Array.from(host.shadowRoot!.children)) {
      expect(budgetedMirror.getId(child)).toEqual(syncMirror.getId(child));
      expect(budgetedMirror.getId(child)).toBeGreaterThan(0);
    }
  });
});
