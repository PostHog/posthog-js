import * as fs from 'fs';
import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import { vi } from 'vitest';
import { launchPuppeteer, waitForRAF } from '../utils';
import type { addedNodeMutation } from '@posthog/rrweb-types';

type scenarioResult = {
  adds: addedNodeMutation[];
  snapshotIds: number[];
  incrementalHtml: string;
  freshHtml: string;
};

// The recorder serializes each added tree from its root down, so an `add` can
// be emitted before an earlier-queued sibling of one of its ancestors. The
// replayer places every node by `parentId` and `nextId`, so that order is only
// safe while both ids resolve at the moment the `add` is applied. These tests
// assert that property directly, and check that replaying the adds builds the
// same DOM as a fresh full snapshot of the mutated page.
describe('mutation add ordering', () => {
  vi.setConfig({ testTimeout: 30_000 });

  let browser: puppeteer.Browser;
  let code: string;

  beforeAll(async () => {
    browser = await launchPuppeteer();
    code = fs.readFileSync(
      path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
      'utf8',
    );
  });

  afterAll(async () => {
    await browser.close();
  });

  const run = async (body: string, mutate: string): Promise<scenarioResult> => {
    const page = await browser.newPage();
    try {
      await page.goto('about:blank');
      await page.setContent(`<!DOCTYPE html>
<html>
  <body>
    ${body}
    <script>
      ${code}
      window.snapshots = [];
      rrweb.record({
        emit: (event) => window.snapshots.push(event),
        recordAfter: 'DOMContentLoaded',
        slimDOMOptions: { comment: true },
      });
    </script>
  </body>
</html>`);
      await waitForRAF(page);
      await page.evaluate(mutate);
      await page.waitForTimeout(50);

      return (await page.evaluate(`(() => {
        const recorded = window.snapshots.slice();
        // A checkout snapshot of the mutated page is the reference DOM: it runs
        // through the same serializer, so blocked and ignored nodes are handled
        // the same way as in the incremental adds.
        rrweb.record.takeFullSnapshot();
        const meta = recorded.find((event) => event.type === 4);
        const fresh = window.snapshots
          .slice(recorded.length)
          .find((event) => event.type === 2);

        const htmlOf = (events) => {
          const replayer = new rrweb.Replayer(events, { mouseTail: false });
          replayer.pause(
            events[events.length - 1].timestamp - events[0].timestamp + 1,
          );
          return replayer.iframe.contentDocument.body.innerHTML.replace(
            /<script[^>]*>[\\s\\S]*?<\\/script>/g,
            '<script></script>',
          );
        };

        const snapshotIds = [];
        const collect = (node) => {
          snapshotIds.push(node.id);
          (node.childNodes || []).forEach(collect);
        };
        collect(recorded.find((event) => event.type === 2).data.node);

        return {
          adds: recorded
            .filter((event) => event.type === 3 && event.data.source === 0)
            .flatMap((event) => event.data.adds),
          snapshotIds,
          incrementalHtml: htmlOf(recorded),
          freshHtml: htmlOf([meta, fresh]),
        };
      })()`)) as scenarioResult;
    } finally {
      await page.close();
    }
  };

  // Every add must land on a parent that already exists, next to a sibling that
  // already exists. The removed secondary add list used to guarantee this by
  // deferring any node whose ids were not resolvable yet.
  const expectResolvableOrder = (result: scenarioResult) => {
    const known = new Set(result.snapshotIds);
    expect(result.adds.length).toBeGreaterThan(0);
    for (const add of result.adds) {
      expect(known.has(add.parentId)).toBe(true);
      if (add.nextId !== null) expect(known.has(add.nextId)).toBe(true);
      known.add(add.node.id);
    }
  };

  const expectSameDom = (result: scenarioResult) => {
    expect(result.incrementalHtml).toEqual(result.freshHtml);
  };

  const elementAdd = (result: scenarioResult, id: string) =>
    result.adds.find(
      (add) => add.node.type === 2 && add.node.attributes.id === id,
    );

  it('serializes a nested tree added in one batch from its root down', async () => {
    const result = await run(
      '<div id="target"></div>',
      `(() => {
        const outer = document.createElement('div');
        outer.id = 'outer';
        const middle = document.createElement('section');
        const inner = document.createElement('span');
        inner.textContent = 'deep';
        middle.appendChild(inner);
        outer.appendChild(middle);
        document.getElementById('target').appendChild(outer);
      })()`,
    );

    expectResolvableOrder(result);
    expectSameDom(result);
    expect(result.adds[0]).toBe(elementAdd(result, 'outer'));
  });

  it('serializes children queued before their parent entered the DOM', async () => {
    const result = await run(
      '<div id="target"></div>',
      `(() => {
        const parent = document.createElement('div');
        parent.id = 'late-parent';
        const child = document.createElement('span');
        child.id = 'late-child';
        // The child mutation record is queued first, but the child cannot be
        // serialized before its parent has an id.
        parent.appendChild(child);
        document.getElementById('target').appendChild(parent);
        child.appendChild(document.createTextNode('late'));
      })()`,
    );

    expectResolvableOrder(result);
    expectSameDom(result);
  });

  it('keeps sibling order when siblings are added in separate records', async () => {
    const result = await run(
      '<div id="target"><b id="anchor"></b></div>',
      `(() => {
        const target = document.getElementById('target');
        const anchor = document.getElementById('anchor');
        ['one', 'two', 'three'].forEach((name) => {
          const el = document.createElement('i');
          el.id = name;
          target.insertBefore(el, anchor);
        });
        const trailing = document.createElement('u');
        trailing.id = 'trailing';
        target.appendChild(trailing);
      })()`,
    );

    expectResolvableOrder(result);
    expectSameDom(result);
    expect(elementAdd(result, 'one').nextId).toBe(
      elementAdd(result, 'two').node.id,
    );
    expect(elementAdd(result, 'trailing').nextId).toBe(null);
  });

  it('places nodes added around a blocked sibling', async () => {
    const result = await run(
      '<div id="target"></div>',
      `(() => {
        const target = document.getElementById('target');
        const blocked = document.createElement('div');
        blocked.className = 'rr-block';
        blocked.appendChild(document.createElement('span'));
        const before = document.createElement('p');
        before.id = 'before-blocked';
        const after = document.createElement('p');
        after.id = 'after-blocked';
        target.append(before, blocked, after);
      })()`,
    );

    expectResolvableOrder(result);
    expectSameDom(result);
    // The blocked node keeps its placeholder, but its child is never serialized.
    expect(
      result.adds.some(
        (add) => add.node.type === 2 && add.node.tagName === 'span',
      ),
    ).toBe(false);
  });

  it('skips an ignored comment when resolving nextId', async () => {
    const result = await run(
      '<div id="target"></div>',
      `(() => {
        const target = document.getElementById('target');
        const first = document.createElement('p');
        first.id = 'first';
        const last = document.createElement('p');
        last.id = 'last';
        target.append(first, document.createComment('ignored'), last);
      })()`,
    );

    expectResolvableOrder(result);
    expectSameDom(result);
    // The comment has no id of its own, so `first` points past it at `last`.
    expect(elementAdd(result, 'first').nextId).toBe(
      elementAdd(result, 'last').node.id,
    );
  });

  it('adds siblings next to blocked and ignored nodes that were already there', async () => {
    const result = await run(
      `<div id="with-blocked"><div class="rr-block"></div></div>
       <div id="with-comment"><!-- already ignored --></div>`,
      `(() => {
        ['with-blocked', 'with-comment'].forEach((id) => {
          const host = document.getElementById(id);
          const leading = document.createElement('p');
          leading.id = id + '-leading';
          host.insertBefore(leading, host.firstChild);
          const trailing = document.createElement('p');
          trailing.id = id + '-trailing';
          host.appendChild(trailing);
        });
      })()`,
    );

    expectResolvableOrder(result);
    expectSameDom(result);
  });

  it('serializes a shadow host together with its shadow content', async () => {
    const result = await run(
      '<div id="target"></div>',
      `(() => {
        const host = document.createElement('div');
        host.id = 'shadow-host';
        host.attachShadow({ mode: 'open' });
        const inner = document.createElement('span');
        inner.textContent = 'in shadow';
        host.shadowRoot.appendChild(inner);
        document.getElementById('target').appendChild(host);
      })()`,
    );

    expectResolvableOrder(result);
    const shadowSpan = result.adds.find(
      (add) => add.node.type === 2 && add.node.tagName === 'span',
    );
    expect(shadowSpan).toBeDefined();
    expect(shadowSpan.parentId).toBe(elementAdd(result, 'shadow-host').node.id);
  });
});
