/**
 * Correctness of the time-sliced full snapshot (`fullSnapshotYieldBudgetMs`).
 *
 * A synchronous full snapshot is atomic: the main thread is blocked, so nothing
 * can happen to the page between the first and the last serialized node. A
 * sliced snapshot gives that up on purpose — the page stays responsive, which
 * means real mutations and real user interactions land *while the snapshot is
 * being built*. Speed is easy to measure; the thing that actually has to hold
 * is that the recording still replays to the same DOM.
 *
 * So these tests don't inspect the event stream for plausibility. For each
 * scenario they:
 *   1. record a large document with a tiny yield budget,
 *   2. perform the scenario's mutations/interactions and *prove* they landed
 *      mid-snapshot (no FullSnapshot had been emitted yet when they ran),
 *   3. replay the resulting events with the real `Replayer`,
 *   4. require the replayed DOM to be identical to the live DOM.
 *
 * Both DOMs are described by running rrweb's own serializer over them, so
 * script placeholders, URL absolutification, stylesheet inlining, input values,
 * scroll offsets and shadow roots are described the same way on both sides and
 * only genuine divergence shows up. Node ids are stripped: they are private to
 * each side, and what matters is that the trees agree.
 *
 * Every scenario also asserts that no event on the wire references a node id the
 * replayer never received — the failure mode of a mirror that has drifted ahead
 * of the replay.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import {
  launchPuppeteer,
  startServer,
  getServerURL,
  waitForRAF,
  fakeGoto,
} from './utils';

// Small enough that the walk yields constantly, so the interleaving window is
// as wide as it can be — the hostile case, not a lucky one.
const YIELD_BUDGET_MS = 1;
// ~50k nodes. Big enough that a sliced snapshot spans hundreds of tasks, so
// `page.evaluate` reliably lands inside the window.
const TABLE_ROWS = 3000;

let server: http.Server;
let serverURL: string;
let browser: puppeteer.Browser;
let rrwebCode: string;
let snapshotCode: string;

// Describes a document the way rrweb itself sees it, minus the ids. Injected
// into both the recorded page and the replay page so the two descriptions are
// produced by identical code.
const CANONICALIZER = `
window.__canon = function (doc) {
  var sn = rrwebSnapshot.snapshot(doc, {
    mirror: rrwebSnapshot.createMirror(),
    blockClass: 'rr-block',
    blockSelector: null,
    maskTextClass: 'rr-mask',
    maskTextSelector: null,
    inlineStylesheet: true,
    maskAllInputs: false,
    slimDOM: false,
    recordCanvas: false,
    inlineImages: false,
  });
  // Ids are per-side bookkeeping; 'rootId' likewise. Everything else is state
  // we require to match.
  function strip(node) {
    if (!node || typeof node !== 'object') return node;
    delete node.id;
    delete node.rootId;
    // rebuild() maps script -> noscript so replayed scripts can't execute.
    // Undo that, narrowly: only a noscript whose sole child is the script
    // placeholder was a script, so a genuine <noscript> is left alone.
    if (
      node.tagName === 'noscript' &&
      node.childNodes &&
      node.childNodes.length === 1 &&
      node.childNodes[0].textContent === 'SCRIPT_PLACEHOLDER'
    ) {
      node.tagName = 'script';
    }
    if (node.childNodes) node.childNodes.forEach(strip);
    return node;
  }
  return JSON.stringify(strip(sn), null, 1);
};

// Things the replayer adds to the rebuilt document that were never recorded
// content: its own injected <style> (a child of <html>, before <head>), the
// paused-animation class, and the ':hover' class it applies to the element
// chain under its virtual cursor to emulate CSS hover.
window.__stripReplayArtifacts = function (doc) {
  var html = doc.documentElement;
  if (!html) return;
  html.classList.remove('rrweb-paused');
  Array.prototype.forEach.call(doc.querySelectorAll('*'), function (el) {
    el.classList.remove(':hover');
    if (el.getAttribute('class') === '') el.removeAttribute('class');
  });
  if (html.getAttribute('class') === '') html.removeAttribute('class');
  var head = doc.head;
  Array.from(html.children).forEach(function (child) {
    if (
      child.tagName === 'STYLE' &&
      head &&
      child.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING
    ) {
      child.remove();
    }
  });
};
`;

function buildDocument(bodyExtra: string): string {
  const rows: string[] = [];
  for (let i = 0; i < TABLE_ROWS; i++) {
    rows.push(
      `<tr id="row-${i}"><td>cell ${i}-a</td><td>cell ${i}-b</td>` +
        `<td><span>cell ${i}-c</span></td><td>${i}</td></tr>`,
    );
  }
  return `<!DOCTYPE html>
<html>
  <head>
    <title>convergence</title>
    <style id="sheet">.base { color: rgb(1, 2, 3); }</style>
  </head>
  <body>
    ${bodyExtra}
    <table id="big"><tbody>${rows.join('')}</tbody></table>
  </body>
</html>`;
}

function buildHtml(bodyExtra: string, budget: number): string {
  const doc = buildDocument(bodyExtra);
  // The walk yields through a MessageChannel macrotask, which makes the real
  // in-flight window a few tens of milliseconds — too narrow for the test
  // runner to reliably land its ops inside. Remove MessageChannel so the
  // cascade falls back to setTimeout(0), whose nesting clamp (~4ms per slice)
  // stretches the window to hundreds of milliseconds. This only stretches the
  // window; the serialization work per slice is unchanged.
  const slowYield = `globalThis.MessageChannel = undefined;`;
  // The sync page gets a same-shape no-op so both documents have identical
  // node structure (any script content serializes as SCRIPT_PLACEHOLDER; an
  // empty script would have no text child at all).
  const script = `
    <script>${budget > 0 ? slowYield : ';'}</script>
    <script>${snapshotCode}</script>
    <script>${rrwebCode}</script>
    <script>${CANONICALIZER}</script>
    <script>
      window.snapshots = [];
      window.__stop = rrweb.record({
        emit: function (event) { window.snapshots.push(event); },
        fullSnapshotYieldBudgetMs: ${budget},
      });
    </script>
  `;
  return doc.replace('</body>', `${script}</body>`);
}

type Scenario = {
  /** Extra markup placed before the big table. */
  body?: string;
  /**
   * Runs in the page while the sliced snapshot is in flight. Anything it
   * returns is handed back to the test for extra assertions.
   */
  ops: () => Promise<unknown> | unknown;
  /** Extra settle time after the FullSnapshot lands, for async sources. */
  settleMs?: number;
};

type ScenarioResult = {
  /** False means the ops really did run before the FullSnapshot was emitted. */
  fullSnapshotAlreadyEmitted: boolean;
  opsResult: unknown;
  liveCanon: string;
  replayedCanon: string;
  unknownIdEvents: Array<{ source: number; id: number }>;
  eventTypes: number[];
  events: Array<Record<string, unknown>>;
};

async function runScenario(
  scenario: Scenario,
  budget: number,
): Promise<ScenarioResult> {
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  try {
    // `fakeGoto` gives the page a real URL without fetching it, so relative
    // URLs resolve the same way they would in production.
    await fakeGoto(page, `${serverURL}/html/convergence.html`);
    await page.setContent(buildHtml(scenario.body ?? '', budget));

    // The inline script above has already emitted Meta and started the walk;
    // with a sliced snapshot the walk is still running right now.
    const probe = await page.evaluate(
      async (opsSrc: string) => {
        const s = window as unknown as {
          snapshots: Array<{ type: number }>;
        };
        // 2 === EventType.FullSnapshot
        const fullSnapshotAlreadyEmitted = s.snapshots.some(
          (e) => e.type === 2,
        );
        const fn = new Function(`return (${opsSrc})`)() as () => unknown;
        const opsResult = await fn();
        return { fullSnapshotAlreadyEmitted, opsResult };
      },
      scenario.ops.toString(),
    );

    await page.waitForFunction('window.snapshots.some((e) => e.type === 2)', {
      timeout: 120_000,
    });
    // Let the post-snapshot flush, the mutation rAF batches and any async
    // source (adopted stylesheets, iframe attach) land.
    await waitForRAF(page);
    await waitForRAF(page);
    await new Promise((r) => setTimeout(r, scenario.settleMs ?? 400));

    const events = (await page.evaluate(
      'window.snapshots',
    )) as ScenarioResult['events'];
    const liveCanon = (await page.evaluate(
      '__canon(document)',
    )) as string;

    // --- replay in a clean page -------------------------------------------
    const replayPage = await browser.newPage();
    replayPage.on('pageerror', (err) =>
      console.log('REPLAY PAGE ERROR:', err.message),
    );
    try {
      await replayPage.goto('about:blank');
      await replayPage.evaluate(snapshotCode);
      await replayPage.evaluate(rrwebCode);
      await replayPage.evaluate(CANONICALIZER);
      await replayPage.evaluate(`window.events = ${JSON.stringify(events)}`);
      // Play the whole recording and wait for the replayer to say it is done,
      // rather than seeking to a timestamp and hoping a couple of frames were
      // enough — under load they are not, and the comparison would race the
      // replayer instead of testing it.
      await replayPage.evaluate(`
        window.__replayFinished = false;
        window.replayer = new rrweb.Replayer(window.events, {
          pauseAnimation: false,
          mouseTail: false,
        });
        window.replayer.on('finish', function () {
          window.__replayFinished = true;
        });
        window.replayer.play(0);
      `);
      await replayPage.waitForFunction('window.__replayFinished === true', {
        timeout: 120_000,
      });
      await waitForRAF(replayPage);
      await waitForRAF(replayPage);

      const { replayedCanon, unknownIdEvents } = (await replayPage.evaluate(`
        (function () {
          var doc = window.replayer.iframe.contentDocument;
          var mirror = window.replayer.getMirror();
          // Any id on the wire that the replayer never learned about means the
          // recorder's mirror drifted ahead of the replay.
          var unknownIdEvents = [];
          window.events.forEach(function (e) {
            if (e.type !== 3) return;
            var d = e.data || {};
            var ids = [];
            if (typeof d.id === 'number') ids.push(d.id);
            (d.positions || []).forEach(function (p) {
              if (typeof p.id === 'number') ids.push(p.id);
            });
            ids.forEach(function (id) {
              if (id < 0) return;
              if (!mirror.getNode(id)) {
                unknownIdEvents.push({ source: d.source, id: id });
              }
            });
          });
          window.__stripReplayArtifacts(doc);
          return {
            replayedCanon: window.__canon(doc),
            unknownIdEvents: unknownIdEvents,
          };
        })()
      `)) as { replayedCanon: string; unknownIdEvents: Array<{ source: number; id: number }> };

      return {
        fullSnapshotAlreadyEmitted: probe.fullSnapshotAlreadyEmitted,
        opsResult: probe.opsResult,
        liveCanon,
        replayedCanon,
        unknownIdEvents,
        eventTypes: events.map((e) => e.type as number),
        events,
      };
    } finally {
      await replayPage.close();
    }
  } finally {
    await page.close();
  }
}

/**
 * The canonical form of a document this size runs to tens of thousands of
 * lines, and dumping two of them tells you nothing. Report only the hunks that
 * actually differ, with a little context.
 */
function diffCanon(live: string, replayed: string, label: string): string {
  const a = live.split('\n');
  const b = replayed.split('\n');
  const hunks: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && hunks.length < 6; i++) {
    if (a[i] === b[i]) continue;
    const from = Math.max(0, i - 4);
    const to = Math.min(Math.max(a.length, b.length), i + 5);
    const context: string[] = [`  @@ line ${i + 1} @@`];
    for (let j = from; j < to; j++) {
      if (a[j] === b[j]) {
        context.push(`   ${a[j] ?? ''}`);
      } else {
        if (a[j] !== undefined) context.push(`  -live     ${a[j]}`);
        if (b[j] !== undefined) context.push(`  +replayed ${b[j]}`);
      }
    }
    hunks.push(context.join('\n'));
    // skip past this hunk
    while (i < a.length && a[i] !== b[i]) i++;
  }
  return `${label}: replayed DOM differs from live DOM\n${hunks.join('\n\n')}`;
}

function expectCanonEqual(live: string, replayed: string, label: string) {
  if (live !== replayed) {
    throw new Error(diffCanon(live, replayed, label));
  }
}

/**
 * Asserts the whole contract for one scenario: the ops really interleaved with
 * the snapshot, the replay converged, and nothing references an unknown node.
 */
async function expectConvergence(scenario: Scenario) {
  const sliced = await runScenario(scenario, YIELD_BUDGET_MS);

  // The test is only meaningful if the ops ran inside the snapshot window.
  expect(sliced.fullSnapshotAlreadyEmitted).toBe(false);
  expect(sliced.unknownIdEvents).toEqual([]);

  // The sliced path has to land where the synchronous path lands. Checked
  // first, and independently of whether the replayer reproduces the page
  // perfectly: this is the property the option owns.
  const sync = await runScenario(scenario, 0);
  expectCanonEqual(sync.liveCanon, sliced.liveCanon, 'live vs live (sliced)');
  expectCanonEqual(
    sync.replayedCanon,
    sliced.replayedCanon,
    'sync replay vs sliced replay',
  );

  // And the replay has to reproduce the page.
  expectCanonEqual(sync.liveCanon, sync.replayedCanon, 'synchronous path');
  expectCanonEqual(sliced.liveCanon, sliced.replayedCanon, 'sliced path');

  return sliced;
}

describe('time-sliced full snapshot converges on replay', () => {
  vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 });

  beforeAll(async () => {
    server = await startServer();
    serverURL = getServerURL(server);
    browser = await launchPuppeteer();
    rrwebCode = fs.readFileSync(
      path.resolve(__dirname, '../dist/rrweb.umd.cjs'),
      'utf8',
    );
    snapshotCode = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../rrweb-snapshot/dist/rrweb-snapshot.umd.cjs',
      ),
      'utf8',
    );
  });

  afterAll(async () => {
    await browser.close();
    server.close();
  });

  it('reproduces the reported case: input, click and append during a yield', async () => {
    // The exact interleaving reported against the first version of this change:
    // wait until nodes have mirror ids, then change an input, dispatch
    // input/click, and append a node — all while the snapshot is yielding.
    await expectConvergence({
      body: `
        <div id="host">
          <input id="field" type="text" value="original" />
          <button id="btn">click me</button>
        </div>
      `,
      ops: async () => {
        const field = document.getElementById('field') as HTMLInputElement;
        const btn = document.getElementById('btn') as HTMLButtonElement;
        field.value = 'typed while snapshotting';
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        btn.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 6 }),
        );
        const appended = document.createElement('p');
        appended.id = 'appended';
        appended.textContent = 'appended mid-snapshot';
        document.getElementById('host')!.appendChild(appended);
        await new Promise((r) => setTimeout(r, 0));
        return {
          value: field.value,
          appended: !!document.getElementById('appended'),
        };
      },
    });
  });

  it('captures DOM adds and removes made during the window', async () => {
    await expectConvergence({
      body: `<div id="target"><span id="doomed">remove me</span></div>`,
      ops: async () => {
        const target = document.getElementById('target')!;
        document.getElementById('doomed')!.remove();
        for (let i = 0; i < 5; i++) {
          const el = document.createElement('div');
          el.className = 'added';
          el.textContent = `added ${i}`;
          target.appendChild(el);
          // spread the work across several yields
          await new Promise((r) => setTimeout(r, 0));
        }
        // remove a node that only existed inside the window
        target.querySelector('.added')!.remove();
        // and mutate a node deep inside the part serialized last
        document.getElementById(`row-${2900}`)!.setAttribute('data-late', 'yes');
      },
    });
  });

  it('keeps the resting scroll offset set during the window', async () => {
    await expectConvergence({
      body: `<div id="scroller" style="height:80px;overflow:auto">
               <div style="height:4000px">tall</div>
             </div>`,
      ops: async () => {
        const scroller = document.getElementById('scroller')!;
        scroller.scrollTop = 120;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
        // the offset that matters is the one it comes to rest at
        scroller.scrollTop = 640;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 0));
        return { scrollTop: scroller.scrollTop };
      },
    });
  });

  it('keeps CSSOM rules inserted during the window, in order', async () => {
    const result = await expectConvergence({
      ops: async () => {
        const sheet = (document.getElementById('sheet') as HTMLStyleElement)
          .sheet!;
        sheet.insertRule('.injected-a { color: rgb(10, 20, 30); }', 1);
        await new Promise((r) => setTimeout(r, 0));
        sheet.insertRule('.injected-b { color: rgb(40, 50, 60); }', 2);
        await new Promise((r) => setTimeout(r, 0));
        sheet.deleteRule(1);
        return {
          rules: Array.from(sheet.cssRules).map((r) => r.cssText),
        };
      },
    });
    // insertRule/deleteRule are index based: a lost insert silently shifts every
    // later index, so assert the surviving rule is the right one.
    const rules = (result.opsResult as { rules: string[] }).rules;
    expect(rules.some((r) => r.includes('injected-b'))).toBe(true);
    expect(rules.some((r) => r.includes('injected-a'))).toBe(false);
  });

  it('keeps shadow DOM mutations made during the window', async () => {
    await expectConvergence({
      body: `<div id="shadow-host"></div>`,
      ops: async () => {
        const host = document.getElementById('shadow-host')!;
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = '<p id="in-shadow">shadow content</p>';
        await new Promise((r) => setTimeout(r, 0));
        const extra = document.createElement('span');
        extra.textContent = 'added inside shadow';
        root.appendChild(extra);
        await new Promise((r) => setTimeout(r, 0));
        root.getElementById?.('in-shadow');
        return { shadowChildren: root.childNodes.length };
      },
    });
  });

  it('does not lose discrete clicks that happen during the window', async () => {
    const result = await expectConvergence({
      body: `<button id="a">a</button><button id="b">b</button>`,
      ops: async () => {
        for (const id of ['a', 'b', 'a']) {
          document
            .getElementById(id)!
            .dispatchEvent(
              new MouseEvent('click', {
                bubbles: true,
                clientX: 1,
                clientY: 2,
              }),
            );
          await new Promise((r) => setTimeout(r, 0));
        }
      },
    });
    // 3 === EventType.IncrementalSnapshot, 2 === IncrementalSource.MouseInteraction
    const clicks = result.events.filter((e) => {
      const d = e.data as { source?: number; type?: number } | undefined;
      return e.type === 3 && d?.source === 2;
    });
    // A click is not self-healing: if it is dropped it is gone for good.
    expect(clicks.length).toBeGreaterThanOrEqual(3);
  });

  it('survives recording being stopped while a snapshot is in flight', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      await page.setContent(buildHtml('', YIELD_BUDGET_MS));
      // Stop the recording while the walk is still yielding.
      const atStop = (await page.evaluate(`
        (function () {
          var sawFullSnapshot = window.snapshots.some(function (e) {
            return e.type === 2;
          });
          window.__stop();
          return {
            sawFullSnapshot: sawFullSnapshot,
            count: window.snapshots.length,
          };
        })()
      `)) as { sawFullSnapshot: boolean; count: number };

      expect(atStop.sawFullSnapshot).toBe(false);

      // Give the abandoned walk more than enough time to have finished had it
      // kept going.
      await new Promise((r) => setTimeout(r, 3000));

      const after = (await page.evaluate(`
        ({
          count: window.snapshots.length,
          types: window.snapshots.map(function (e) { return e.type; }),
          mirrorIds: rrweb.record.mirror.getIds().length,
        })
      `)) as { count: number; types: number[]; mirrorIds: number };

      // No FullSnapshot for a recording that no longer exists, nothing emitted
      // after teardown, and the shared mirror left clean for the next session.
      expect(after.types).not.toContain(2);
      expect(after.count).toBe(atStop.count);
      expect(after.mirrorIds).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
