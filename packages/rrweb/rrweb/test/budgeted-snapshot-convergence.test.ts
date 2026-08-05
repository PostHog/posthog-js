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

function buildDocument(bodyExtra: string, bodyTail = ''): string {
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
    ${bodyTail}
  </body>
</html>`;
}

function buildHtml(
  bodyExtra: string,
  budget: number,
  recordOptions = '',
  bodyTail = '',
  keepMessageChannel = false,
): string {
  const doc = buildDocument(bodyExtra, bodyTail);
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
    <script>${budget > 0 && !keepMessageChannel ? slowYield : ';'}</script>
    <script>${snapshotCode}</script>
    <script>${rrwebCode}</script>
    <script>${CANONICALIZER}</script>
    <script>
      window.snapshots = [];
      window.__stop = rrweb.record({
        emit: function (event) { window.snapshots.push(event); },
        fullSnapshotYieldBudgetMs: ${budget},
        ${recordOptions}
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
  /** Extra properties spliced into the record() options object. */
  recordOptions?: string;
  /** Overrides the "recording is done" condition (default: one FullSnapshot). */
  waitFor?: string;
  /** Markup placed AFTER the big table — deep in the walk's frontier. */
  bodyTail?: string;
  /** Keep the production MessageChannel yielder instead of the slow fallback. */
  keepMessageChannel?: boolean;
  /** Extra expression evaluated in the replay page (against `replayer`). */
  replayProbe?: string;
};

type ScenarioResult = {
  /** False means the ops really did run before the FullSnapshot was emitted. */
  fullSnapshotAlreadyEmitted: boolean;
  opsResult: unknown;
  liveCanon: string;
  replayedCanon: string;
  /** body.innerHTML of the first same-origin iframe in the replayed document. */
  replayedIframeHtml: string;
  unknownIdEvents: Array<{ source: number; id: number }>;
  /** Node ids delivered as an add while already attached — double delivery. */
  duplicateAddIds: number[];
  replayProbeResult: unknown;
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
    await page.setContent(
      buildHtml(
        scenario.body ?? '',
        budget,
        scenario.recordOptions ?? '',
        scenario.bodyTail ?? '',
        scenario.keepMessageChannel ?? false,
      ),
    );

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

    await page.waitForFunction(
      scenario.waitFor ?? 'window.snapshots.some((e) => e.type === 2)',
      { timeout: 120_000 },
    );
    // Let the post-snapshot flush, the mutation rAF batches and any async
    // source (adopted stylesheets, iframe attach) land.
    await waitForRAF(page);
    await waitForRAF(page);
    await new Promise((r) => setTimeout(r, scenario.settleMs ?? 400));

    const events = (await page.evaluate(
      'window.snapshots',
    )) as ScenarioResult['events'];

    // The wire must be in timestamp order no matter what interleaved with the
    // walk — a replayer applies events in array order, and a timestamp that
    // jumps backwards corrupts seek and skip logic.
    for (let i = 1; i < events.length; i++) {
      const prev = (events[i - 1] as { timestamp: number }).timestamp;
      const cur = (events[i] as { timestamp: number }).timestamp;
      if (cur < prev) {
        throw new Error(
          `event stream not monotonic: event[${i}] (type ${String(
            events[i].type,
          )}) at ${cur} follows ${prev}`,
        );
      }
    }
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

      const {
        replayedCanon,
        unknownIdEvents,
        duplicateAddIds,
        replayedIframeHtml,
        replayProbeResult,
      } = (await replayPage.evaluate(`
        (function () {
          var doc = window.replayer.iframe.contentDocument;
          // Any id on the wire that the recording never introduced (via the
          // FullSnapshot or a mutation add) *before* referencing it means the
          // recorder's mirror drifted ahead of the replay. Replayed in event
          // order so a reference ahead of its add is caught too. A removed id
          // stays known: the reference was valid when it applied.
          var unknownIdEvents = [];
          var known = new Set();
          // A node id delivered as an add while already attached means the
          // same node was described twice (walker AND buffer both claimed
          // it) — the replayer tolerates it, so final-state convergence
          // alone can't catch double delivery. Attachment tracking can.
          // Removing an id detaches its whole recorded subtree, mirroring
          // the replayer, so a moved parent's re-added children are not
          // false positives.
          var attached = new Set();
          var childrenOf = new Map();
          var parentOf = new Map();
          var duplicateAddIds = [];
          function linkChild(parentId, childId) {
            // a re-learned (moved) child leaves its old parent's set, or a
            // later removal of that old parent would detach it spuriously
            var previousParent = parentOf.get(childId);
            if (previousParent !== undefined && childrenOf.has(previousParent)) {
              childrenOf.get(previousParent).delete(childId);
            }
            if (!childrenOf.has(parentId)) childrenOf.set(parentId, new Set());
            childrenOf.get(parentId).add(childId);
            parentOf.set(childId, parentId);
          }
          function learn(sn, parentId) {
            if (!sn) return;
            known.add(sn.id);
            if (attached.has(sn.id)) {
              duplicateAddIds.push(sn.id);
            }
            attached.add(sn.id);
            if (typeof parentId === 'number') linkChild(parentId, sn.id);
            (sn.childNodes || []).forEach(function (child) {
              learn(child, sn.id);
            });
          }
          function detach(id) {
            attached.delete(id);
            parentOf.delete(id);
            var kids = childrenOf.get(id);
            if (kids) {
              childrenOf.delete(id);
              kids.forEach(detach);
            }
          }
          window.events.forEach(function (e) {
            if (e.type === 2) {
              attached = new Set();
              childrenOf = new Map();
              parentOf = new Map();
              learn(e.data.node, undefined);
              return;
            }
            if (e.type !== 3) return;
            var d = e.data || {};
            var ids = [];
            if (typeof d.id === 'number') ids.push(d.id);
            (d.positions || []).forEach(function (p) {
              if (typeof p.id === 'number') ids.push(p.id);
            });
            (d.removes || []).forEach(function (r) {
              if (typeof r.id === 'number') ids.push(r.id);
              if (typeof r.parentId === 'number') ids.push(r.parentId);
            });
            (d.adds || []).forEach(function (a) {
              if (typeof a.parentId === 'number') ids.push(a.parentId);
            });
            (d.texts || []).forEach(function (t) {
              if (typeof t.id === 'number') ids.push(t.id);
            });
            (d.attributes || []).forEach(function (a) {
              if (typeof a.id === 'number') ids.push(a.id);
            });
            // the replayer applies removes before adds within a batch, so a
            // remove+add of the same id (a move) is not double delivery
            (d.removes || []).forEach(function (r) {
              detach(r.id);
            });
            // adds are learned before checking: within one mutation batch the
            // payload may reference a parent added later in the same batch
            // (the replayer buffers out-of-order adds), which is legitimate
            (d.adds || []).forEach(function (a) {
              learn(a.node, a.parentId);
            });
            ids.forEach(function (id) {
              if (id < 0) return;
              if (!known.has(id)) {
                unknownIdEvents.push({ source: d.source, id: id });
              }
            });
          });
          window.__stripReplayArtifacts(doc);
          var innerFrame = doc.querySelector('iframe');
          var replayedIframeHtml = '';
          try {
            replayedIframeHtml =
              (innerFrame &&
                innerFrame.contentDocument &&
                innerFrame.contentDocument.body &&
                innerFrame.contentDocument.body.innerHTML) ||
              '';
          } catch (err) {
            replayedIframeHtml = 'inaccessible: ' + err;
          }
          return {
            replayedCanon: window.__canon(doc),
            unknownIdEvents: unknownIdEvents,
            duplicateAddIds: duplicateAddIds,
            replayedIframeHtml: replayedIframeHtml,
            replayProbeResult: ${
              scenario.replayProbe
                ? `(${scenario.replayProbe})(doc)`
                : 'null'
            },
          };
        })()
      `)) as {
          replayedCanon: string;
          unknownIdEvents: Array<{ source: number; id: number }>;
          duplicateAddIds: number[];
          replayedIframeHtml: string;
          replayProbeResult: unknown;
        };

      return {
        fullSnapshotAlreadyEmitted: probe.fullSnapshotAlreadyEmitted,
        opsResult: probe.opsResult,
        liveCanon,
        replayedCanon,
        replayedIframeHtml,
        unknownIdEvents,
        duplicateAddIds,
        replayProbeResult,
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
  expect(sliced.duplicateAddIds).toEqual([]);

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
    // The exact interleaving from the review that found the original bug:
    // wait until the input and <body> are ALREADY SERIALIZED (they have
    // mirror entries), then — while the snapshot is still yielding — change
    // the input, dispatch input/click events, and append a node. The
    // reported failure was a recording containing only Meta + FullSnapshot,
    // with the FullSnapshot retaining the old input value and omitting the
    // appended node while both changes existed in the live DOM.
    const result = await expectConvergence({
      body: `
        <div id="host">
          <input id="field" type="text" value="original" />
          <button id="btn">click me</button>
        </div>
      `,
      ops: async () => {
        const field = document.getElementById('field') as HTMLInputElement;
        const btn = document.getElementById('btn') as HTMLButtonElement;
        const recordMirror = (
          window as unknown as {
            rrweb: {
              record: {
                mirror: { hasNode: (n: Node) => boolean };
              };
            };
          }
        ).rrweb.record.mirror;
        // The reviewer's precondition, verified rather than assumed. hasNode
        // (mirror membership) instead of getId: with id reservation active,
        // getId would answer a reserved id for a not-yet-serialized node —
        // and reserve one as a side effect.
        const deadline = Date.now() + 30_000;
        while (
          !(recordMirror.hasNode(field) && recordMirror.hasNode(document.body))
        ) {
          if (Date.now() > deadline) {
            throw new Error('field/body were never serialized');
          }
          await new Promise((r) => setTimeout(r, 0));
        }
        const snapshotStillInFlight = !(
          window as unknown as { snapshots: Array<{ type: number }> }
        ).snapshots.some((e) => e.type === 2);

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
          snapshotStillInFlight,
          value: field.value,
          appended: !!document.getElementById('appended'),
        };
      },
    });

    // The ops ran in the reported window: nodes serialized, snapshot in flight.
    const ops = result.opsResult as {
      snapshotStillInFlight: boolean;
      value: string;
      appended: boolean;
    };
    expect(ops.snapshotStillInFlight).toBe(true);

    // The inverse of the reported failure, event by event: the recording must
    // contain more than Meta + FullSnapshot —
    const incremental = result.events.filter((e) => e.type === 3);
    // the input change (source 5), carrying the new value;
    expect(
      incremental.some((e) => {
        const d = e.data as { source?: number; text?: string };
        return d.source === 5 && d.text === 'typed while snapshotting';
      }),
    ).toBe(true);
    // the click (source 2, MouseInteraction);
    expect(
      incremental.some(
        (e) => (e.data as { source?: number }).source === 2,
      ),
    ).toBe(true);
    // and the appended node's mutation add.
    expect(
      incremental.some((e) => {
        const d = e.data as {
          source?: number;
          adds?: Array<{ node: { attributes?: { id?: string } } }>;
        };
        return (
          d.source === 0 &&
          (d.adds ?? []).some((a) => a.node.attributes?.id === 'appended')
        );
      }),
    ).toBe(true);
    // (the DOM-level truth — new value present, node present — is what
    // expectConvergence already proved by replaying against the live DOM)
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
    // Recorder-side contract only. Full DOM convergence is not asserted here
    // because the *replayer's* fast-forward path applies element scroll
    // offsets unfaithfully regardless of this option — with the identical ops
    // the synchronous path (budget=0) replays to the wrong offset too, so the
    // recording is not what loses the offset. What this option owns: the
    // scroll events observed during the window survive it, attached to an id
    // the replayer knows, with the resting offset (the one the element ends
    // at) on the wire. The scroll observer's dedup updates *before* emitting,
    // so a dropped event here would be unrecoverable — that is the regression
    // this guards against.
    const sliced = await runScenario(
      {
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
      },
      YIELD_BUDGET_MS,
    );
    expect(sliced.fullSnapshotAlreadyEmitted).toBe(false);
    expect(sliced.unknownIdEvents).toEqual([]);
    // 3 === IncrementalSnapshot, 3 === IncrementalSource.Scroll
    const scrolls = sliced.events.filter((e) => {
      const d = e.data as { source?: number; y?: number } | undefined;
      return e.type === 3 && d?.source === 3;
    });
    const restingOffsets = scrolls.map(
      (e) => (e.data as { y: number }).y,
    );
    expect(restingOffsets).toContain(640);
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

  it('captures mutations to nodes serialized in the first slices', async () => {
    // The walk visits the top of the document first, so by the time the ops
    // run these nodes are already in the mirror with claimed ids. Their
    // buffered mutations must apply against the finished snapshot.
    await expectConvergence({
      body: `<div id="early"><b id="early-b">bold</b><i id="early-i" title="x">it</i></div>`,
      ops: async () => {
        // let the walk get past the top of the document
        await new Promise((r) => setTimeout(r, 60));
        const b = document.getElementById('early-b')!;
        const i = document.getElementById('early-i')!;
        b.textContent = 'changed after serialization';
        i.setAttribute('title', 'retitled');
        i.setAttribute('data-new', 'added');
        b.classList.add('later');
        await new Promise((r) => setTimeout(r, 0));
        // and a text change deep in the late region for the other epoch
        document.getElementById('row-2900')!.firstElementChild!.textContent =
          'late edit';
      },
    });
  });

  it('scrubs events for a node created and interacted with mid-walk', async () => {
    // A node created during the walk inside already-visited territory gets a
    // reserved id its subtree walk will never claim. Its held events must be
    // scrubbed (the buffered add re-serializes final state), and nothing on
    // the wire may reference an id the replayer never receives.
    const result = await expectConvergence({
      body: `<div id="early-host"></div>`,
      ops: async () => {
        await new Promise((r) => setTimeout(r, 60));
        const input = document.createElement('input');
        input.id = 'born-mid-walk';
        document.getElementById('early-host')!.appendChild(input);
        input.value = 'final value';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: 3, clientY: 3 }),
        );
        await new Promise((r) => setTimeout(r, 0));
        return { value: input.value };
      },
    });
    // unknownIdEvents === [] (asserted inside expectConvergence) is the real
    // assertion; convergence proves the value arrived via the buffered add.
    expect(result.unknownIdEvents).toEqual([]);
  });

  it('keeps mutations made inside a same-origin iframe during the window', async () => {
    const result = await expectConvergence({
      body: `<iframe id="frame" srcdoc="<div id='inner'>inner content</div>"></iframe>`,
      settleMs: 800,
      ops: async () => {
        const frame = document.getElementById('frame') as HTMLIFrameElement;
        const inner = frame.contentDocument!.getElementById('inner')!;
        inner.textContent = 'mutated mid-walk';
        const added = frame.contentDocument!.createElement('p');
        added.id = 'iframe-added';
        added.textContent = 'added mid-walk';
        frame.contentDocument!.body.appendChild(added);
        await new Promise((r) => setTimeout(r, 0));
        return {
          innerText: inner.textContent,
        };
      },
    });
    // The canonical comparison does not descend into iframes (their content
    // travels as separate attach events), so assert the replayed iframe
    // content directly: both mutations must be visible.
    expect(result.replayedIframeHtml).toContain('mutated mid-walk');
    expect(result.replayedIframeHtml).toContain('iframe-added');
  });

  it('does not lose media interactions that happen during the window', async () => {
    // No canonical comparison here: a synthetic `play` does not change the
    // live element's paused state, but the replayer honours the event, so the
    // two sides legitimately differ. What must hold: the event survives the
    // window with an id the replayer knows, in timestamp order.
    const sliced = await runScenario(
      {
        body: `<video id="vid" width="100" height="50"></video>`,
        ops: async () => {
          const vid = document.getElementById('vid')!;
          vid.dispatchEvent(new Event('play'));
          await new Promise((r) => setTimeout(r, 0));
          vid.dispatchEvent(new Event('pause'));
        },
      },
      YIELD_BUDGET_MS,
    );
    expect(sliced.fullSnapshotAlreadyEmitted).toBe(false);
    expect(sliced.unknownIdEvents).toEqual([]);
    // 3 === IncrementalSnapshot, 7 === IncrementalSource.MediaInteraction
    const media = sliced.events.filter((e) => {
      const d = e.data as { source?: number } | undefined;
      return e.type === 3 && d?.source === 7;
    });
    expect(media.length).toBeGreaterThanOrEqual(2);
  });

  it('does not lose canvas mutations that happen during the window', async () => {
    // Same shape as media: canvas replay is pixel-level (out of scope here);
    // the recorder-level contract is that the mutation survives the window
    // attached to an id the replayer knows.
    const sliced = await runScenario(
      {
        body: `<canvas id="cv" width="60" height="40"></canvas>`,
        recordOptions: 'recordCanvas: true,',
        settleMs: 800,
        ops: async () => {
          const ctx = (
            document.getElementById('cv') as HTMLCanvasElement
          ).getContext('2d')!;
          ctx.fillStyle = 'rgb(200, 10, 10)';
          ctx.fillRect(2, 2, 30, 20);
          await new Promise((r) => setTimeout(r, 0));
        },
      },
      YIELD_BUDGET_MS,
    );
    expect(sliced.fullSnapshotAlreadyEmitted).toBe(false);
    expect(sliced.unknownIdEvents).toEqual([]);
    // 9 === IncrementalSource.CanvasMutation
    const canvas = sliced.events.filter((e) => {
      const d = e.data as { source?: number } | undefined;
      return e.type === 3 && d?.source === 9;
    });
    expect(canvas.length).toBeGreaterThanOrEqual(1);
  });

  it('coalesces a checkout requested while a snapshot is in flight', async () => {
    const result = await expectConvergence({
      body: `<div id="mark"></div>`,
      waitFor: 'window.snapshots.filter((e) => e.type === 2).length >= 2',
      settleMs: 800,
      ops: async () => {
        document.getElementById('mark')!.textContent = 'before checkout';
        // ask for another full snapshot while the first is mid-walk — it must
        // coalesce into one follow-up, not interleave
        (window as unknown as { rrweb: { record: { takeFullSnapshot: (c?: boolean) => void } } })
          .rrweb.record.takeFullSnapshot(true);
        await new Promise((r) => setTimeout(r, 0));
        document.getElementById('mark')!.textContent = 'after checkout request';
      },
    });
    const fullSnapshots = result.eventTypes.filter((t) => t === 2);
    expect(fullSnapshots.length).toBe(2);
  });

  it('does not serialize ghost nodes removed or moved while still unvisited', async () => {
    // The walker serves child lists captured slices earlier. A pre-existing
    // node removed while in that captured-but-unvisited frontier produced no
    // buffered removal (it was never in the mirror), so serializing the stale
    // reference would put a node in the FullSnapshot that nothing ever
    // removes. Same for a node moved out of the frontier into already-visited
    // territory: only its new home is real.
    await expectConvergence({
      body: `<div id="early-dest"></div>`,
      ops: async () => {
        await new Promise((r) => setTimeout(r, 60));
        // removed while deep in the unvisited frontier
        document.getElementById('row-2950')!.remove();
        // moved from the frontier into already-visited territory
        document
          .getElementById('early-dest')!
          .appendChild(document.getElementById('row-2960')!);
        await new Promise((r) => setTimeout(r, 0));
        // and a whole subtree removed from the frontier
        document.getElementById('row-2970')!.remove();
      },
    });
  });

  it('does not double-apply CSSOM rules inserted before their sheet is serialized', async () => {
    // The sheet lives at the BOTTOM of the body — deep in the walk's frontier
    // — so the ops run long before the walker reaches it: the FullSnapshot
    // inlines the inserted rules. Delivering the held insertRule events
    // afterwards would apply them twice and shift every later index — they
    // must be dropped at the gate instead.
    const result = await expectConvergence({
      bodyTail: `<style id="late-sheet">.tail { color: rgb(9, 9, 9); }</style>`,
      ops: async () => {
        const sheet = (
          document.getElementById('late-sheet') as HTMLStyleElement
        ).sheet!;
        sheet.insertRule('.tail-a { color: rgb(11, 22, 33); }', 1);
        await new Promise((r) => setTimeout(r, 0));
        sheet.insertRule('.tail-b { color: rgb(44, 55, 66); }', 2);
        return {
          rules: Array.from(sheet.cssRules).map((r) => r.cssText),
        };
      },
    });
    // the live sheet has 3 rules; the replayed sheet must too — not 5
    const opsRules = (result.opsResult as { rules: string[] }).rules;
    expect(opsRules.length).toBe(3);
  });

  it('coalesces checkouts triggered by held events during the flush', async () => {
    // checkoutEveryNth counts incremental events and calls takeFullSnapshot
    // from inside wrappedEmit — including for held events being flushed. A
    // request landing mid-flush must coalesce into the follow-up snapshot,
    // not start a walk whose locks the ongoing flush then destroys.
    const result = await expectConvergence({
      body: `<button id="clicker">c</button>`,
      recordOptions: 'checkoutEveryNth: 3,',
      waitFor: 'window.snapshots.filter((e) => e.type === 2).length >= 2',
      settleMs: 800,
      ops: async () => {
        const btn = document.getElementById('clicker')!;
        for (let i = 0; i < 6; i++) {
          btn.dispatchEvent(
            new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }),
          );
          await new Promise((r) => setTimeout(r, 0));
        }
      },
    });
    // enough clicks to trip the checkout threshold at least once
    const fullSnapshots = result.eventTypes.filter((t) => t === 2).length;
    expect(fullSnapshots).toBeGreaterThanOrEqual(2);
  });

  it('a stopped walk does not poison the next recording session', async () => {
    // stop() mid-walk and immediately record() again: the abandoned walk's
    // cleanup must not touch the new session's id reservation or buffers.
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      await page.setContent(buildHtml('', YIELD_BUDGET_MS));
      const probe = (await page.evaluate(`
        (function () {
          var firstStillInFlight = !window.snapshots.some(function (e) {
            return e.type === 2;
          });
          window.__stop();
          // second session, same tick — the first walk is still parked on a
          // yield and will wake up into this session's world
          window.snapshots2 = [];
          window.__stop2 = rrweb.record({
            emit: function (e) { window.snapshots2.push(e); },
            fullSnapshotYieldBudgetMs: 0,
          });
          var marker = document.createElement('div');
          marker.id = 'second-session-mutation';
          document.body.appendChild(marker);
          return { firstStillInFlight: firstStillInFlight };
        })()
      `)) as { firstStillInFlight: boolean };
      expect(probe.firstStillInFlight).toBe(true);

      await page.waitForFunction(
        'window.snapshots2.some((e) => e.type === 2)',
        { timeout: 120_000 },
      );
      await new Promise((r) => setTimeout(r, 800));

      const after = (await page.evaluate(`
        ({
          firstStream: window.snapshots.map(function (e) { return e.type; }),
          secondHasFullSnapshot: window.snapshots2.some(function (e) {
            return e.type === 2;
          }),
          secondHasMutation: window.snapshots2.some(function (e) {
            return e.type === 3 && e.data && e.data.source === 0 &&
              e.data.adds && e.data.adds.some(function (add) {
                return add.node && add.node.attributes &&
                  add.node.attributes.id === 'second-session-mutation';
              });
          }),
          secondCount: window.snapshots2.length,
        })
      `)) as {
        firstStream: number[];
        secondHasFullSnapshot: boolean;
        secondHasMutation: boolean;
        secondCount: number;
      };
      // the dead session must not have received a FullSnapshot, and the new
      // session must have produced its own, without errors
      expect(after.firstStream).not.toContain(2);
      expect(after.secondHasFullSnapshot).toBe(true);
      expect(after.secondHasMutation).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  // Shared by the two rotation tests below: every id-bearing payload position
  // in a stream, so `< 0` finds an event that resolved against a dead
  // reservation, and the unknown-id walk finds references the replayer never
  // receives. Runs inside the page.
  const STREAM_CHECKERS = `
    window.__collectNegativeIds = function (events) {
      var negative = [];
      function check(id) {
        if (typeof id === 'number' && id < 0) negative.push(id);
      }
      events.forEach(function (e) {
        var d = e.data || {};
        if (e.type === 3) {
          check(d.id);
          (d.positions || []).forEach(function (p) { check(p.id); });
          (d.removes || []).forEach(function (r) { check(r.id); check(r.parentId); });
          (d.adds || []).forEach(function (a) { check(a.parentId); check(a.node && a.node.id); });
          (d.texts || []).forEach(function (t) { check(t.id); });
          (d.attributes || []).forEach(function (a) { check(a.id); });
          (d.ranges || []).forEach(function (r) { check(r.start); check(r.end); });
        } else if (e.type === 5 && d.payload) {
          check(d.payload.id);
        }
      });
      return negative;
    };
    window.__collectUnknownIds = function (events) {
      var known = new Set();
      var unknown = [];
      function learn(sn) {
        if (!sn) return;
        known.add(sn.id);
        (sn.childNodes || []).forEach(learn);
      }
      function check(id) {
        if (typeof id === 'number' && id >= 0 && !known.has(id)) unknown.push(id);
      }
      events.forEach(function (e) {
        if (e.type === 2) { learn(e.data.node); return; }
        if (e.type !== 3) return;
        var d = e.data || {};
        (d.adds || []).forEach(function (a) { learn(a.node); });
        check(d.id);
        (d.positions || []).forEach(function (p) { check(p.id); });
        (d.adds || []).forEach(function (a) { check(a.parentId); });
        (d.texts || []).forEach(function (t) { check(t.id); });
        (d.attributes || []).forEach(function (a) { check(a.id); });
      });
      return unknown;
    };
  `;

  it('survives stop() + record() called from inside the FullSnapshot consumer callback', async () => {
    // The reviewer's reentrancy case: the consumer synchronously rotates the
    // recorder from the very emit that delivers the sliced FullSnapshot. The
    // old walk's completion resumes AFTER record() has reset the mirror and
    // begun the new session's id reservation, so it must stand down instead
    // of pausing/ending that live reservation, flushing its held window
    // through the new consumer, or poking the new canvas manager.
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      const doc = buildDocument('<button id="held-btn">h</button>', '');
      const script = `
        <script>globalThis.MessageChannel = undefined;</script>
        <script>${snapshotCode}</script>
        <script>${rrwebCode}</script>
        <script>${STREAM_CHECKERS}</script>
        <script>
          window.snapshots = [];
          window.snapshots2 = [];
          window.__rotated = false;
          window.__stop = rrweb.record({
            emit: function (event) {
              window.snapshots.push(event);
              if (event.type === 2 && !window.__rotated) {
                window.__rotated = true;
                window.__stop();
                window.__stop2 = rrweb.record({
                  emit: function (e) { window.snapshots2.push(e); },
                  fullSnapshotYieldBudgetMs: ${YIELD_BUDGET_MS},
                });
              }
            },
            fullSnapshotYieldBudgetMs: ${YIELD_BUDGET_MS},
          });
        </script>
      `;
      await page.setContent(doc.replace('</body>', `${script}</body>`));

      // Bank held events in the FIRST session while its walk is in flight:
      // real clicks plus a taggable custom event to trace leakage precisely.
      const probe = (await page.evaluate(`
        (function () {
          var inFlight = !window.snapshots.some(function (e) {
            return e.type === 2;
          });
          rrweb.record.addCustomEvent('held-in-first-session', {});
          document.getElementById('held-btn').dispatchEvent(
            new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 })
          );
          return { inFlight: inFlight };
        })()
      `)) as { inFlight: boolean };
      expect(probe.inFlight).toBe(true);

      await page.waitForFunction('window.__rotated === true', {
        timeout: 120_000,
      });

      // The second session's walk is now in flight with a live reservation.
      // Click nodes it has not visited yet: if the old completion ended the
      // reservation, these resolve to -1.
      const midWalk = (await page.evaluate(`
        (function () {
          var inFlight = !window.snapshots2.some(function (e) {
            return e.type === 2;
          });
          ['row-2900', 'row-2950'].forEach(function (id) {
            document.getElementById(id).firstElementChild.dispatchEvent(
              new MouseEvent('click', { bubbles: true, clientX: 2, clientY: 2 })
            );
          });
          return { inFlight: inFlight };
        })()
      `)) as { inFlight: boolean };
      expect(midWalk.inFlight).toBe(true);

      await page.waitForFunction(
        'window.snapshots2.some((e) => e.type === 2)',
        { timeout: 120_000 },
      );
      await new Promise((r) => setTimeout(r, 800));

      const after = (await page.evaluate(`
        ({
          firstFullSnapshots: window.snapshots.filter(function (e) {
            return e.type === 2;
          }).length,
          secondFullSnapshots: window.snapshots2.filter(function (e) {
            return e.type === 2;
          }).length,
          heldLeakedToSecond: window.snapshots2.some(function (e) {
            return e.type === 5 && e.data && e.data.tag === 'held-in-first-session';
          }),
          heldFlushedToFirst: window.snapshots.some(function (e) {
            return e.type === 5 && e.data && e.data.tag === 'held-in-first-session';
          }),
          negativeIdsFirst: window.__collectNegativeIds(window.snapshots),
          negativeIdsSecond: window.__collectNegativeIds(window.snapshots2),
          unknownIdsSecond: window.__collectUnknownIds(window.snapshots2),
          secondClickCount: window.snapshots2.filter(function (e) {
            return e.type === 3 && e.data && e.data.source === 2 && e.data.type === 2;
          }).length,
        })
      `)) as {
        firstFullSnapshots: number;
        secondFullSnapshots: number;
        heldLeakedToSecond: boolean;
        heldFlushedToFirst: boolean;
        negativeIdsFirst: number[];
        negativeIdsSecond: number[];
        unknownIdsSecond: number[];
        secondClickCount: number;
      };

      // the new session's walk completed and owns exactly one FullSnapshot
      expect(after.firstFullSnapshots).toBe(1);
      expect(after.secondFullSnapshots).toBe(1);
      // the old session's held window must not release through the new
      // consumer; the abandoned completion drops it entirely
      expect(after.heldLeakedToSecond).toBe(false);
      expect(after.heldFlushedToFirst).toBe(false);
      // no event on either wire resolved against a dead reservation
      expect(after.negativeIdsFirst).toEqual([]);
      expect(after.negativeIdsSecond).toEqual([]);
      // and the new session's stream is fully resolvable by a replayer
      expect(after.unknownIdsSecond).toEqual([]);
      // the mid-walk clicks survived on reserved ids the walk then claimed,
      // proof the old completion did not end the new session's reservation
      expect(after.secondClickCount).toBeGreaterThanOrEqual(2);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('abandons the rest of the flush when the consumer rotates on a held event (posthog stop/start shape)', async () => {
    // posthog-js rotates by calling stop() then record() from inside its emit
    // callback, which can fire on a HELD event mid-flush, after the
    // FullSnapshot but before the buffer commit. Everything after that
    // delivery (the held tail, the commit, endIdReservation, the canvas
    // reset) must be abandoned, not applied to the new session.
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      const doc = buildDocument('', '');
      const script = `
        <script>globalThis.MessageChannel = undefined;</script>
        <script>${snapshotCode}</script>
        <script>${rrwebCode}</script>
        <script>${STREAM_CHECKERS}</script>
        <script>
          window.snapshots = [];
          window.snapshots2 = [];
          window.__rotated = false;
          window.__stop = rrweb.record({
            emit: function (event) {
              window.snapshots.push(event);
              if (
                !window.__rotated &&
                event.type === 5 &&
                event.data &&
                event.data.tag === 'rotate-now'
              ) {
                window.__rotated = true;
                window.__stop();
                window.__stop2 = rrweb.record({
                  emit: function (e) { window.snapshots2.push(e); },
                  fullSnapshotYieldBudgetMs: ${YIELD_BUDGET_MS},
                });
              }
            },
            fullSnapshotYieldBudgetMs: ${YIELD_BUDGET_MS},
          });
        </script>
      `;
      await page.setContent(doc.replace('</body>', `${script}</body>`));

      const probe = (await page.evaluate(`
        (function () {
          var inFlight = !window.snapshots.some(function (e) {
            return e.type === 2;
          });
          // both are held; the first one's delivery rotates the recorder, so
          // the second must never reach any consumer
          rrweb.record.addCustomEvent('rotate-now', {});
          rrweb.record.addCustomEvent('held-after-rotate', {});
          return { inFlight: inFlight };
        })()
      `)) as { inFlight: boolean };
      expect(probe.inFlight).toBe(true);

      await page.waitForFunction('window.__rotated === true', {
        timeout: 120_000,
      });

      const midWalk = (await page.evaluate(`
        (function () {
          var inFlight = !window.snapshots2.some(function (e) {
            return e.type === 2;
          });
          document.getElementById('row-2900').firstElementChild.dispatchEvent(
            new MouseEvent('click', { bubbles: true, clientX: 2, clientY: 2 })
          );
          return { inFlight: inFlight };
        })()
      `)) as { inFlight: boolean };
      expect(midWalk.inFlight).toBe(true);

      await page.waitForFunction(
        'window.snapshots2.some((e) => e.type === 2)',
        { timeout: 120_000 },
      );
      await new Promise((r) => setTimeout(r, 800));

      const after = (await page.evaluate(`
        ({
          firstHasFullSnapshot: window.snapshots.some(function (e) {
            return e.type === 2;
          }),
          firstHasRotateNow: window.snapshots.some(function (e) {
            return e.type === 5 && e.data && e.data.tag === 'rotate-now';
          }),
          heldTailInFirst: window.snapshots.some(function (e) {
            return e.type === 5 && e.data && e.data.tag === 'held-after-rotate';
          }),
          heldTailInSecond: window.snapshots2.some(function (e) {
            return e.type === 5 && e.data && e.data.tag === 'held-after-rotate';
          }),
          secondFullSnapshots: window.snapshots2.filter(function (e) {
            return e.type === 2;
          }).length,
          negativeIdsSecond: window.__collectNegativeIds(window.snapshots2),
          unknownIdsSecond: window.__collectUnknownIds(window.snapshots2),
          secondClickCount: window.snapshots2.filter(function (e) {
            return e.type === 3 && e.data && e.data.source === 2 && e.data.type === 2;
          }).length,
        })
      `)) as {
        firstHasFullSnapshot: boolean;
        firstHasRotateNow: boolean;
        heldTailInFirst: boolean;
        heldTailInSecond: boolean;
        secondFullSnapshots: number;
        negativeIdsSecond: number[];
        unknownIdsSecond: number[];
        secondClickCount: number;
      };

      // the first session got its FullSnapshot and the held event that
      // triggered the rotation, in that order
      expect(after.firstHasFullSnapshot).toBe(true);
      expect(after.firstHasRotateNow).toBe(true);
      // the held tail dies with the rotation: through NEITHER consumer
      expect(after.heldTailInFirst).toBe(false);
      expect(after.heldTailInSecond).toBe(false);
      // and the new session is intact end to end
      expect(after.secondFullSnapshots).toBe(1);
      expect(after.negativeIdsSecond).toEqual([]);
      expect(after.unknownIdsSecond).toEqual([]);
      expect(after.secondClickCount).toBeGreaterThanOrEqual(1);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('rolls a failed sliced walk back to a synchronous checkpoint', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      await page.setContent(
        buildHtml(
          '<p class="rr-mask">force the masking callback</p>',
          YIELD_BUDGET_MS,
          `
            maskTextFn: function (text) {
              if (!window.__snapshotFailureInjected) {
                window.__snapshotFailureInjected = true;
                throw new Error('injected budgeted snapshot failure');
              }
              return text.replace(/\\S/g, '*');
            },
          `,
        ),
      );

      await page.waitForFunction('window.snapshots.some((e) => e.type === 2)', {
        timeout: 120_000,
      });
      await page.evaluate(`
        (function () {
          var marker = document.createElement('div');
          marker.id = 'after-recovery';
          document.body.appendChild(marker);
        })()
      `);
      await new Promise((r) => setTimeout(r, 500));

      const result = (await page.evaluate(`
        (function () {
          var fullIndex = window.snapshots.findIndex(function (e) {
            return e.type === 2;
          });
          return {
            fullIndex: fullIndex,
            incrementalsBeforeFull: window.snapshots
              .slice(0, fullIndex)
              .filter(function (e) { return e.type === 3; }).length,
            mutationAfterRecovery: window.snapshots
              .slice(fullIndex + 1)
              .some(function (e) {
                return e.type === 3 && e.data && e.data.source === 0 &&
                  e.data.adds && e.data.adds.some(function (add) {
                    return add.node && add.node.attributes &&
                      add.node.attributes.id === 'after-recovery';
                  });
              }),
          };
        })()
      `)) as {
        fullIndex: number;
        incrementalsBeforeFull: number;
        mutationAfterRecovery: boolean;
      };

      expect(result.fullIndex).toBeGreaterThanOrEqual(0);
      expect(result.incrementalsBeforeFull).toBe(0);
      expect(result.mutationAfterRecovery).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('stops after a synchronous full snapshot failure', async () => {
    const page = await browser.newPage();
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      await page.setContent(
        buildHtml(
          '<p class="rr-mask">force the masking callback</p>',
          0,
          `
            maskTextFn: function () {
              throw new Error('injected synchronous snapshot failure');
            },
          `,
        ),
      );
      await new Promise((r) => setTimeout(r, 200));

      const result = (await page.evaluate(`
        (async function () {
          var countAfterFailure = window.snapshots.length;
          var customEventRejected = false;
          try {
            rrweb.record.addCustomEvent('must-not-emit', {});
          } catch (error) {
            customEventRejected = true;
          }
          var marker = document.createElement('button');
          marker.id = 'after-sync-failure';
          document.body.appendChild(marker);
          marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
          return {
            countAfterFailure: countAfterFailure,
            finalCount: window.snapshots.length,
            customEventRejected: customEventRejected,
            hasFullSnapshot: window.snapshots.some(function (e) {
              return e.type === 2;
            }),
          };
        })()
      `)) as {
        countAfterFailure: number;
        finalCount: number;
        customEventRejected: boolean;
        hasFullSnapshot: boolean;
      };

      expect(result.hasFullSnapshot).toBe(false);
      expect(result.customEventRejected).toBe(true);
      expect(result.finalCount).toBe(result.countAfterFailure);
    } finally {
      await page.close();
    }
  });

  it('recovers from a synchronous checkout failure without tearing recording down', async () => {
    const page = await browser.newPage();
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      await page.setContent(
        buildHtml(
          '<p class="rr-mask">fail only on checkout</p>',
          0,
          `
            maskTextFn: function (text) {
              if (window.__failSynchronousCheckout) {
                throw new Error('injected synchronous checkout failure');
              }
              return text;
            },
          `,
        ),
      );
      await page.waitForFunction('window.snapshots.some((e) => e.type === 2)');

      const result = (await page.evaluate(`
        (async function () {
          window.__failSynchronousCheckout = true;
          // the failure propagates to the caller (the SDK catches and
          // retries) instead of being swallowed into silent teardown
          var checkoutThrew = false;
          try {
            rrweb.record.takeFullSnapshot(true);
          } catch (error) {
            checkoutThrew = true;
          }
          var fullSnapshotsAfterFailure = window.snapshots.filter(function (e) {
            return e.type === 2;
          }).length;
          // recording survives: custom events are accepted and interactions
          // keep being observed against the last good snapshot
          var customEventRejected = false;
          try {
            rrweb.record.addCustomEvent('emitted-after-checkout-failure', {});
          } catch (error) {
            customEventRejected = true;
          }
          var marker = document.createElement('button');
          marker.id = 'after-sync-checkout-failure';
          document.body.appendChild(marker);
          marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          await new Promise(function (resolve) { setTimeout(resolve, 100); });
          // the failed checkout released its buffer locks: the next checkout
          // must succeed outright
          window.__failSynchronousCheckout = false;
          rrweb.record.takeFullSnapshot(true);
          await new Promise(function (resolve) { setTimeout(resolve, 50); });
          return {
            checkoutThrew: checkoutThrew,
            fullSnapshotsAfterFailure: fullSnapshotsAfterFailure,
            customEventRejected: customEventRejected,
            hasCustomEvent: window.snapshots.some(function (e) {
              return e.type === 5 && e.data && e.data.tag === 'emitted-after-checkout-failure';
            }),
            hasMarkerMutation: window.snapshots.some(function (e) {
              return JSON.stringify(e).indexOf('after-sync-checkout-failure') !== -1;
            }),
            fullSnapshots: window.snapshots.filter(function (e) {
              return e.type === 2;
            }).length,
          };
        })()
      `)) as {
        checkoutThrew: boolean;
        fullSnapshotsAfterFailure: number;
        customEventRejected: boolean;
        hasCustomEvent: boolean;
        hasMarkerMutation: boolean;
        fullSnapshots: number;
      };

      expect(result.checkoutThrew).toBe(true);
      expect(result.fullSnapshotsAfterFailure).toBe(1);
      expect(result.customEventRejected).toBe(false);
      expect(result.hasCustomEvent).toBe(true);
      expect(result.hasMarkerMutation).toBe(true);
      // the retried checkout produced a second FullSnapshot — the locks from
      // the failed one did not strand
      expect(result.fullSnapshots).toBe(2);
    } finally {
      await page.close();
    }
  });

  it('bounds held events and recovers instead of flushing a partial queue', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      await page.setContent(buildHtml('', YIELD_BUDGET_MS));
      const beforeRecovery = (await page.evaluate(`
        (function () {
          for (var i = 0; i < 4100; i++) {
            rrweb.record.addCustomEvent('queue-pressure', { index: i });
          }
          return {
            hasFullSnapshot: window.snapshots.some(function (e) {
              return e.type === 2;
            }),
            customEvents: window.snapshots.filter(function (e) {
              return e.type === 5;
            }).length,
          };
        })()
      `)) as { hasFullSnapshot: boolean; customEvents: number };

      // DOMContentLoaded/Load may precede the transaction, but held events
      // cannot escape before a FullSnapshot.
      expect(beforeRecovery.hasFullSnapshot).toBe(false);
      expect(beforeRecovery.customEvents).toBe(0);
      await page.waitForFunction('window.snapshots.some((e) => e.type === 2)', {
        timeout: 120_000,
      });
      await page.evaluate(`
        (function () {
          var marker = document.createElement('div');
          marker.id = 'after-queue-recovery';
          document.body.appendChild(marker);
        })()
      `);
      await new Promise((r) => setTimeout(r, 500));

      const result = (await page.evaluate(`
        (function () {
          var fullIndex = window.snapshots.findIndex(function (e) {
            return e.type === 2;
          });
          return {
            customEvents: window.snapshots.filter(function (e) {
              return e.type === 5 && e.data && e.data.tag === 'queue-pressure';
            }).length,
            incrementalsBeforeFull: window.snapshots
              .slice(0, fullIndex)
              .filter(function (e) { return e.type === 3; }).length,
            mutationAfterRecovery: window.snapshots
              .slice(fullIndex + 1)
              .some(function (e) {
                return e.type === 3 && e.data && e.data.source === 0 &&
                  e.data.adds && e.data.adds.some(function (add) {
                    return add.node && add.node.attributes &&
                      add.node.attributes.id === 'after-queue-recovery';
                  });
              }),
          };
        })()
      `)) as {
        customEvents: number;
        incrementalsBeforeFull: number;
        mutationAfterRecovery: boolean;
      };

      expect(result.customEvents).toBe(0);
      expect(result.incrementalsBeforeFull).toBe(0);
      expect(result.mutationAfterRecovery).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('falls back to a synchronous snapshot when the consumer emit throws on the retry Meta', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      // the duplicate `emit` key overrides buildHtml's default consumer
      await page.setContent(
        buildHtml(
          '',
          YIELD_BUDGET_MS,
          `
            emit: function (event) {
              if (window.__failNextMeta && event.type === 4) {
                window.__failNextMeta = false;
                throw new Error('injected consumer Meta failure');
              }
              window.snapshots.push(event);
            },
          `,
        ),
      );
      // Overflow the held-event queue so the walk fails with a retryable
      // reason, then make the consumer's emit throw at the retry's Meta. The
      // recovery must land in the synchronous fallback, not in a live
      // recorder that never emits a FullSnapshot.
      const beforeRecovery = (await page.evaluate(`
        (function () {
          for (var i = 0; i < 4200; i++) {
            rrweb.record.addCustomEvent('queue-pressure', { index: i });
          }
          window.__failNextMeta = true;
          return {
            hasFullSnapshot: window.snapshots.some(function (e) {
              return e.type === 2;
            }),
          };
        })()
      `)) as { hasFullSnapshot: boolean };
      expect(beforeRecovery.hasFullSnapshot).toBe(false);

      await page.waitForFunction('window.snapshots.some((e) => e.type === 2)', {
        timeout: 120_000,
      });
      await page.evaluate(`
        (function () {
          var marker = document.createElement('div');
          marker.id = 'after-meta-throw-recovery';
          document.body.appendChild(marker);
        })()
      `);
      await new Promise((r) => setTimeout(r, 500));

      const result = (await page.evaluate(`
        (function () {
          var statuses = window.snapshots
            .filter(function (e) {
              return e.type === 5 && e.data &&
                e.data.tag === 'budgeted-full-snapshot';
            })
            .map(function (e) { return e.data.payload.status; });
          var fullIndex = window.snapshots.findIndex(function (e) {
            return e.type === 2;
          });
          return {
            statuses: statuses,
            fullSnapshots: window.snapshots.filter(function (e) {
              return e.type === 2;
            }).length,
            mutationAfterRecovery: window.snapshots
              .slice(fullIndex + 1)
              .some(function (e) {
                return JSON.stringify(e).indexOf('after-meta-throw-recovery') !== -1;
              }),
          };
        })()
      `)) as {
        statuses: string[];
        fullSnapshots: number;
        mutationAfterRecovery: boolean;
      };

      expect(result.statuses).toContain('budgeted-retry');
      expect(result.statuses).toContain('sync-fallback');
      expect(result.fullSnapshots).toBe(1);
      expect(result.mutationAfterRecovery).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
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

  it('keeps the whole subtree when a serialized ancestor moves before its children are reached', async () => {
    // The hardest structural case: tbody is serialized early, its thousands of
    // rows are still pending, and then the entire tbody moves to a different
    // container. The buffer must deliver tbody AND every pending row at the
    // new location — a remove(tbody)+add(tbody) pair with no child adds
    // permanently loses the subtree in replay.
    await expectConvergence({
      body: '<div id="new-home"></div>',
      ops: async () => {
        const mirror = (
          window as unknown as {
            rrweb: {
              record: {
                mirror: { hasNode: (n: Node) => boolean };
              };
            };
          }
        ).rrweb.record.mirror;
        const tbody = document.querySelector('tbody')!;
        const lateRow = document.getElementById('row-2900')!;
        // preconditions verified, not assumed: the ancestor is in the mirror,
        // deep rows are not yet. The move itself always happens so the sync
        // control arm produces the same final DOM.
        while (!mirror.hasNode(tbody)) {
          await new Promise((r) => setTimeout(r, 5));
        }
        const movedInWindow = !mirror.hasNode(lateRow);
        document.getElementById('new-home')!.appendChild(tbody);
        return { movedInWindow };
      },
      settleMs: 2500,
    }).then((result) => {
      expect(
        (result.opsResult as { movedInWindow: boolean }).movedInWindow,
      ).toBe(true);
    });
  });

  it('converges when pending siblings are reordered within the same parent', async () => {
    // A node reordered inside its own container passes the walker's
    // container-identity revalidation, so without the buffer as the single
    // source of truth it would be frozen into the snapshot at its captured
    // (stale) index with no corrective event ever emitted.
    await expectConvergence({
      ops: async () => {
        const mirror = (
          window as unknown as {
            rrweb: {
              record: {
                mirror: { hasNode: (n: Node) => boolean };
              };
            };
          }
        ).rrweb.record.mirror;
        const tbody = document.querySelector('tbody')!;
        const first = document.getElementById('row-0')!;
        const last = document.getElementById('row-2999')!;
        while (!mirror.hasNode(tbody)) {
          await new Promise((r) => setTimeout(r, 5));
        }
        const reorderedInWindow = !mirror.hasNode(last);
        // move the still-pending last row to the front, and a serialized row
        // to the back — both directions of the same hazard. Performed
        // unconditionally so the sync control arm matches.
        tbody.insertBefore(last, first);
        tbody.appendChild(document.getElementById('row-1')!);
        return { reorderedInWindow };
      },
      settleMs: 1500,
    }).then((result) => {
      expect(
        (result.opsResult as { reorderedInWindow: boolean }).reorderedInWindow,
      ).toBe(true);
    });
  });

  it('delivers adopted stylesheets for shadow roots created during the walk', async () => {
    const result = await expectConvergence({
      ops: () => {
        // standard web-component pattern: host appended into long-visited
        // territory, shadow attached, styles adopted — all mid-walk
        const host = document.createElement('div');
        host.id = 'late-shadow-host';
        document.body.insertBefore(host, document.body.firstChild);
        const root = host.attachShadow({ mode: 'open' });
        const span = document.createElement('span');
        span.textContent = 'shadow-content';
        root.appendChild(span);
        const sheet = new CSSStyleSheet();
        sheet.replaceSync('.adopted-marker { color: rgb(9, 9, 9); }');
        root.adoptedStyleSheets = [sheet];
        return { adopted: true };
      },
      settleMs: 1200,
    });

    // the adopted styles must reach the wire referencing an id the replayer
    // knows — scrubbing them loses shadow styling for the rest of the session
    const adoptedEvents = result.events.filter((e) => {
      const data = e.data as
        | { source?: number; styles?: Array<{ rules: Array<{ rule: string }> }> }
        | undefined;
      return (
        e.type === 3 &&
        data?.source === 15 &&
        JSON.stringify(data).includes('adopted-marker')
      );
    });
    expect(adoptedEvents.length).toBeGreaterThan(0);
  });

  it('replays CSSOM rules the snapshot could not inline (var() shorthand keeps raw text)', async () => {
    // `margin: var(--m)` makes stringifyStylesheet emit empty longhands, so
    // serializeTextNode keeps the raw author text — the snapshot does NOT
    // contain rules inserted into the live CSSOM during the walk, and the
    // held delta must be delivered, not dropped.
    const result = await expectConvergence({
      bodyTail:
        '<style id="var-sheet" data-probe>.v { margin: var(--m); }</style>',
      ops: async () => {
        const mirror = (
          window as unknown as {
            rrweb: {
              record: { mirror: { hasNode: (n: Node) => boolean } };
            };
          }
        ).rrweb.record.mirror;
        const sheetEl = document.getElementById(
          'var-sheet',
        ) as HTMLStyleElement;
        const insertedInWindow = !mirror.hasNode(sheetEl);
        sheetEl.sheet!.insertRule('.inserted-var-rule { color: rgb(7, 7, 7); }', 1);
        return {
          insertedInWindow,
          liveRules: Array.from(sheetEl.sheet!.cssRules).map((r) => r.cssText),
        };
      },
      settleMs: 1200,
      replayProbe: `function (doc) {
        var el = doc.querySelector('style[data-probe]');
        if (!el || !el.sheet) return null;
        return Array.prototype.map.call(el.sheet.cssRules, function (r) {
          return r.cssText;
        });
      }`,
    });

    const ops = result.opsResult as {
      insertedInWindow: boolean;
      liveRules?: string[];
    };
    expect(ops.insertedInWindow).toBe(true);
    const replayedRules = result.replayProbeResult as string[];
    expect(replayedRules).not.toBeNull();
    expect(
      replayedRules.some((r) => r.includes('inserted-var-rule')),
    ).toBe(true);
    expect(replayedRules.length).toBe(ops.liveRules!.length);
  });

  it('does not double-apply CSSOM rules the snapshot did inline', async () => {
    // The mirror image: a clean single-text sheet whose serialization DOES
    // read the live CSSOM. A rule inserted before the sheet is serialized is
    // inside the snapshot; delivering the held delta too would apply it twice
    // and shift every later rule index.
    const result = await expectConvergence({
      bodyTail:
        '<style id="clean-sheet" data-probe>.c { color: rgb(3, 3, 3); }</style>',
      ops: async () => {
        const mirror = (
          window as unknown as {
            rrweb: {
              record: { mirror: { hasNode: (n: Node) => boolean } };
            };
          }
        ).rrweb.record.mirror;
        const sheetEl = document.getElementById(
          'clean-sheet',
        ) as HTMLStyleElement;
        const insertedInWindow = !mirror.hasNode(sheetEl);
        sheetEl.sheet!.insertRule('.inserted-clean-rule { color: rgb(8, 8, 8); }', 1);
        return {
          insertedInWindow,
          liveRuleCount: sheetEl.sheet!.cssRules.length,
        };
      },
      settleMs: 1200,
      replayProbe: `function (doc) {
        var el = doc.querySelector('style[data-probe]');
        if (!el || !el.sheet) return null;
        return Array.prototype.map.call(el.sheet.cssRules, function (r) {
          return r.cssText;
        });
      }`,
    });

    const ops = result.opsResult as {
      insertedInWindow: boolean;
      liveRuleCount?: number;
    };
    expect(ops.insertedInWindow).toBe(true);
    const replayedRules = result.replayProbeResult as string[];
    expect(replayedRules).not.toBeNull();
    // exactly once: present, not duplicated
    expect(
      replayedRules.filter((r) => r.includes('inserted-clean-rule')).length,
    ).toBe(1);
    expect(replayedRules.length).toBe(ops.liveRuleCount);
  });

  it('does not run away when the walk takes longer than checkoutEveryNms', async () => {
    // The FullSnapshot is backdated to walk start, so a checkout clock keyed
    // to the event timestamp sees, on a held event flushed after the walk,
    // (observation time - walk start) — the walk takes seconds and
    // checkoutEveryNms is 200ms, so a single held event re-trips a checkout
    // immediately at flush. The clock must run from when the snapshot reached
    // the wire instead: this exact recording must produce exactly ONE
    // FullSnapshot.
    const page = await browser.newPage();
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      await page.setContent(
        buildHtml('', YIELD_BUDGET_MS, 'checkoutEveryNms: 200,'),
      );
      const probe = (await page.evaluate(`
        (async function () {
          var inFlight = !window.snapshots.some(function (e) {
            return e.type === 2;
          });
          // give the walk enough runway that the marker lands >200ms after
          // walk start, then mutate — the held mutation's observation
          // timestamp is what the broken clock would evaluate at flush
          await new Promise(function (resolve) { setTimeout(resolve, 400); });
          var stillInFlight = !window.snapshots.some(function (e) {
            return e.type === 2;
          });
          var marker = document.createElement('div');
          marker.id = 'held-checkout-bait';
          document.body.appendChild(marker);
          return { inFlight: inFlight, stillInFlight: stillInFlight };
        })()
      `)) as { inFlight: boolean; stillInFlight: boolean };
      expect(probe.inFlight).toBe(true);
      expect(probe.stillInFlight).toBe(true);

      await page.waitForFunction('window.snapshots.some((e) => e.type === 2)', {
        timeout: 120_000,
      });
      await new Promise((r) => setTimeout(r, 2000));
      const fullSnapshots = (await page.evaluate(
        'window.snapshots.filter(function (e) { return e.type === 2; }).length',
      )) as number;

      // nothing after the flush exceeds the 200ms clock, so a second
      // FullSnapshot can only come from the backdated-timestamp runaway
      expect(fullSnapshots).toBe(1);
    } finally {
      await page.close();
    }
  });

  it('releases buffer locks even when the consumer emit throws mid-flush', async () => {
    const page = await browser.newPage();
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      const doc = buildDocument('', '');
      const script = `
        <script>globalThis.MessageChannel = undefined;</script>
        <script>${snapshotCode}</script>
        <script>${rrwebCode}</script>
        <script>
          window.snapshots = [];
          window.__stop = rrweb.record({
            emit: function (event) {
              if (
                event.type === 5 &&
                event.data &&
                event.data.tag === 'boom'
              ) {
                throw new Error('injected consumer emit failure');
              }
              window.snapshots.push(event);
            },
            fullSnapshotYieldBudgetMs: ${YIELD_BUDGET_MS},
          });
        </script>
      `;
      await page.setContent(doc.replace('</body>', `${script}</body>`));

      const probe = (await page.evaluate(`
        (function () {
          var inFlight = !window.snapshots.some(function (e) {
            return e.type === 2;
          });
          // held during the walk; the flush's re-emit of it will throw inside
          // the consumer callback, inside the flush
          rrweb.record.addCustomEvent('boom', {});
          return { inFlight: inFlight };
        })()
      `)) as { inFlight: boolean };
      expect(probe.inFlight).toBe(true);

      await page.waitForFunction('window.snapshots.some((e) => e.type === 2)', {
        timeout: 120_000,
      });
      const result = (await page.evaluate(`
        (async function () {
          var marker = document.createElement('div');
          marker.id = 'after-emit-throw';
          document.body.appendChild(marker);
          await new Promise(function (resolve) { setTimeout(resolve, 400); });
          return {
            mutationDelivered: window.snapshots.some(function (e) {
              return JSON.stringify(e).indexOf('after-emit-throw') !== -1;
            }),
          };
        })()
      `)) as { mutationDelivered: boolean };

      // the throw must not leave the buffers locked: mutations observed after
      // the flush still reach the wire
      expect(result.mutationDelivered).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('converges through the production MessageChannel yielder', async () => {
    // Every other scenario stretches the walk via the setTimeout fallback;
    // this one runs the code path production actually takes. The window is
    // tens of milliseconds, too narrow to reliably land ops inside — so this
    // asserts convergence and wire integrity, not interleaving.
    const sliced = await runScenario(
      {
        keepMessageChannel: true,
        ops: () => {
          const marker = document.createElement('div');
          marker.id = 'mc-marker';
          document.body.appendChild(marker);
          return {};
        },
        settleMs: 800,
      },
      YIELD_BUDGET_MS,
    );
    expect(sliced.unknownIdEvents).toEqual([]);
    expect(sliced.duplicateAddIds).toEqual([]);
    expect(sliced.eventTypes).toContain(2);
    expectCanonEqual(
      sliced.liveCanon,
      sliced.replayedCanon,
      'MessageChannel yielder path',
    );
  });

  it('flushes the walk synchronously when the page hides', async () => {
    const page = await browser.newPage();
    try {
      await fakeGoto(page, `${serverURL}/html/convergence.html`);
      await page.setContent(buildHtml('', YIELD_BUDGET_MS));

      const result = (await page.evaluate(`
        (function () {
          var inFlight = !window.snapshots.some(function (e) {
            return e.type === 2;
          });
          rrweb.record.addCustomEvent('typed-before-hide', { value: 42 });
          // a dying page's parked yield never fires; the pagehide handler
          // must complete the walk and flush in THIS task
          window.dispatchEvent(new Event('pagehide'));
          return {
            inFlight: inFlight,
            hasFullSnapshotNow: window.snapshots.some(function (e) {
              return e.type === 2;
            }),
            hasHeldCustomNow: window.snapshots.some(function (e) {
              return e.type === 5 && e.data && e.data.tag === 'typed-before-hide';
            }),
          };
        })()
      `)) as {
        inFlight: boolean;
        hasFullSnapshotNow: boolean;
        hasHeldCustomNow: boolean;
      };

      expect(result.inFlight).toBe(true);
      // both were on the wire synchronously, inside the dispatch task
      expect(result.hasFullSnapshotNow).toBe(true);
      expect(result.hasHeldCustomNow).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('held events keep their observation timestamps through the flush', async () => {
    const result = await expectConvergence({
      ops: async () => {
        // the target must already be serialized: a click on a claimed id is
        // delivered with its observation timestamp, while events on mid-walk
        // nodes are deferred past the commit and deliberately re-stamped
        const mirror = (
          window as unknown as {
            rrweb: {
              record: { mirror: { hasNode: (n: Node) => boolean } };
            };
          }
        ).rrweb.record.mirror;
        const target = document.getElementById('row-0')!;
        while (!mirror.hasNode(target)) {
          await new Promise((r) => setTimeout(r, 5));
        }
        target.dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        );
        return { clickedAt: Date.now() };
      },
      settleMs: 800,
    });

    const clickedAt = (result.opsResult as { clickedAt: number }).clickedAt;
    // 2 === MouseInteraction, interaction type 2 === Click
    const click = result.events.find((e) => {
      const data = e.data as { source?: number; type?: number } | undefined;
      return e.type === 3 && data?.source === 2 && data?.type === 2;
    }) as { timestamp: number } | undefined;
    expect(click).toBeDefined();
    // observation time, not flush time: the walk runs for seconds after the
    // click, so a re-stamped event would sit far from clickedAt
    expect(Math.abs(click!.timestamp - clickedAt)).toBeLessThan(1000);
  });

  it('delivers selections spanning nodes created during the walk', async () => {
    const result = await expectConvergence({
      ops: async () => {
        // node created in visited territory mid-walk, then selected: the
        // Selection event references reserved ids only the commit's add will
        // introduce, so it must be deferred past the commit, not dropped
        const paragraph = document.createElement('p');
        paragraph.id = 'late-selectable';
        paragraph.textContent = 'select this text';
        document.body.insertBefore(paragraph, document.body.firstChild);
        const range = document.createRange();
        range.selectNodeContents(paragraph);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        // selectionchange delivers async
        await new Promise((r) => setTimeout(r, 50));
        return { selected: true };
      },
      settleMs: 1200,
    });

    // 14 === IncrementalSource.Selection
    const selections = result.events.filter((e) => {
      const data = e.data as { source?: number } | undefined;
      return e.type === 3 && data?.source === 14;
    });
    expect(selections.length).toBeGreaterThan(0);
    // and none of them reference an unknown id (expectConvergence asserted
    // unknownIdEvents === [] — this pins that a selection actually survived)
  });
});
