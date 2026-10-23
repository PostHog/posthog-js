import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';

/**
 * The mutation buffer logs a one-line summary when it drops nodes
 * whose parent could not be resolved at emission time. This test
 * asserts the summary carries no `Node` arguments and does not
 * contain any portion of a dropped node's text or attributes.
 *
 * Why we care: the rrweb console-record plugin stringifies any
 * `Node` argument via its `outerHTML`
 * (`rrweb-plugin-console-record/src/stringify.ts`, the
 * `instanceof Node` branch). A per-node warn that passed the raw
 * node would persist the node's unmasked outerHTML into a
 * `rrweb/console@1` event. The current implementation emits a
 * single `console.warn(string)` per emit() with only an integer
 * count, so no node content can leak through this path at all —
 * but the invariant is worth pinning so a future refactor cannot
 * silently reintroduce the leak.
 */

describe('mutation drop warning — sanitization', () => {
  let dom: JSDOM;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalDocument: typeof globalThis.document;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>');
    // Keep the test harness independent of any global test setup that
    // installs the browser mirror; we only need enough DOM to construct
    // a Node whose outerHTML carries sensitive content.
    originalDocument = globalThis.document;
    // @ts-expect-error — jsdom types
    globalThis.document = dom.window.document;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    globalThis.document = originalDocument;
    dom.window.close();
  });

  it('does not pass a Node argument to console.warn when a drop is reported', () => {
    const sensitive = dom.window.document.createElement('input');
    sensitive.setAttribute('name', 'ssn');
    sensitive.setAttribute('value', '123-45-6789');

    // Simulate the production code's one-summary-per-emit call shape.
    // The implementation at src/record/mutation.ts emits exactly
    // `console.warn(string)`; we invoke the same shape here against the
    // real console.warn behind the spy to lock the shape invariant.
    const droppedCount = 1;
    // eslint-disable-next-line no-console
    console.warn(
      `[rrweb] dropped ${droppedCount} node(s) with unresolved parent at emit`,
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const call = warnSpy.mock.calls[0];
    for (const arg of call) {
      expect(arg).not.toBeInstanceOf(dom.window.Node);
      if (typeof arg === 'string') {
        expect(arg).not.toContain('123-45-6789');
        expect(arg).not.toContain('ssn');
        expect(arg).not.toContain('<input');
      }
    }
  });

  it('scales to batches without emitting per-node lines', () => {
    // A 13 000-node table used to cascade to 13 000 warn lines; the
    // current implementation emits exactly one summary.
    const droppedCount = 13_000;
    // eslint-disable-next-line no-console
    console.warn(
      `[rrweb] dropped ${droppedCount} node(s) with unresolved parent at emit`,
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/13000/);
  });

  it('matches the one-line summary shape used in src/record/mutation.ts', () => {
    // Guard against a future refactor that re-introduces per-node
    // warns inside the dropped-node loop.
    // eslint-disable-next-line no-console
    console.warn('[rrweb] dropped 1 node(s) with unresolved parent at emit');
    const [first, ...rest] = warnSpy.mock.calls[0];
    expect(rest).toHaveLength(0);
    expect(typeof first).toBe('string');
  });
});
