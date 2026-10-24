// @vitest-environment jsdom
//
// Regression for a drain walk-up bug flagged by @fasyy612 on #5244 and
// corrected by @TueHaulund on review:
//
// The forward sibling walk inside the topological drain used to break
// on the first sibling not in addedSet. getNextId skips past IGNORED_NODE
// siblings (slimDOM-ignored tags like <script>) when computing nextId,
// so a new node inserted BEFORE an ignored sibling could be dropped
// when the next new sibling sits AFTER the ignored one — the drain
// would stop at the ignored sibling and never reach the later addition.
//
// Three conditions have to line up for the pre-fix walk to actually
// drop the node (an earlier version of this fixture missed two of
// them):
//   1. The ignored <script> must already exist on the page BEFORE the
//      recorder starts, so it is in the mirror as IGNORED_NODE by the
//      time the walk runs. If the <script> is in the same batch, the
//      walk sees `addedSet.has(script) === false` for other reasons
//      and the probe-past-IGNORED fix would be invisible.
//   2. The new node under test must NOT be the last child of its
//      parent, otherwise the lastChild jump above the walk skips the
//      walk entirely.
//   3. There must be at least one existing (non-addedSet, non-ignored)
//      sibling after the new node, so the walk has to probe past the
//      ignored script and then terminate when it finds the existing
//      sibling.
//
// The ported upstream #1652 fixtures all exercise contiguous addedSet
// siblings or batches where the new node is lastChild, so they miss
// this path entirely.

import { afterEach, describe, expect, it } from 'vitest';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('mutation drain — forward walk skips IGNORED_NODE siblings (#5244)', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    if (stop) stop();
    stop = undefined;
    document.body.innerHTML = '';
  });

  it('serializes an addedSet sibling that sits between an already-ignored script and an existing sibling', async () => {
    // Condition 1: the <script> and the pre-existing <div> are in the
    // DOM BEFORE the recorder starts, so they are mirrored first and
    // the script already carries IGNORED_NODE when the drain runs.
    document.body.innerHTML =
      '<main id="fixture">' +
      '<script>/* seed */</script>' +
      '<div id="trailing-existing"></div>' +
      '</main>';
    const fixture = document.getElementById('fixture')!;
    const existing = document.getElementById('trailing-existing')!;

    const events: Array<{ type: number; data?: { adds?: unknown[] } }> = [];
    stop = record({
      // rrweb's default slimDOMOptions filters <script> out of the
      // mirror as IGNORED_NODE, which is the configuration this test
      // asserts against.
      slimDOMOptions: 'all',
      emit: (event) => {
        events.push(event as { type: number; data?: { adds?: unknown[] } });
      },
    });
    await settle();

    // Condition 2 and 3: insert two new <div>s, one before the already-
    // ignored script and one between the script and the existing <div>.
    // The second new node is NOT lastChild (existing <div> is), so the
    // lastChild jump above the walk is skipped and the walk has to run.
    const beforeScript = document.createElement('div');
    beforeScript.setAttribute('data-i', 'before-script');
    const betweenScriptAndExisting = document.createElement('div');
    betweenScriptAndExisting.setAttribute('data-i', 'after-script');

    const scriptNode = fixture.querySelector('script')!;
    fixture.insertBefore(beforeScript, scriptNode);
    fixture.insertBefore(betweenScriptAndExisting, existing);

    await settle();
    await settle();

    // Both new <div>s must have shipped. The pre-fix walk would start
    // at `beforeScript`, probe forward, see the script with
    // `addedSet.has(script) === false`, break, and leave
    // `betweenScriptAndExisting` undrained. The probe-past-IGNORED
    // loop added in d80c33fbe lets the walk continue past the
    // ignored script, pick up `betweenScriptAndExisting`, and
    // terminate at the pre-existing <div>.
    const addedAttrs: string[] = [];
    for (const event of events) {
      if (event.type !== 3 || !event.data?.adds) continue;
      for (const add of event.data.adds as Array<{
        node: { attributes?: Record<string, string> };
      }>) {
        const i = add.node?.attributes?.['data-i'];
        if (i) addedAttrs.push(i);
      }
    }
    expect(addedAttrs).toContain('before-script');
    expect(addedAttrs).toContain('after-script');

    // Terminating case: the walk must stop at the pre-existing <div>
    // and leave no entries in addedSet.
    const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
    expect((buffer as unknown as { addedSet: Set<Node> }).addedSet.size).toBe(0);
  });
});
