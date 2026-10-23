// @vitest-environment jsdom
//
// Regression for a drain walk-up bug flagged by @fasyy612 on #5244:
//
// The forward sibling walk inside the topological drain used to break
// on the first sibling not in addedSet. getNextId skips past IGNORED_NODE
// siblings (slimDOM-ignored tags like <script>) when computing nextId,
// so a new node inserted BEFORE an ignored sibling could be dropped
// when the next new sibling sits AFTER the ignored one — the drain
// would stop at the ignored node and never reach the later addition.
//
// The ported upstream #1652 fixtures all exercise contiguous addedSet
// siblings, so they hit the lastChild jump above the walk and miss
// this path entirely. This test puts the pathological shape in the
// DOM directly:
//
//   <parent>
//     [addedSet] <div data-i="a"/>
//     [ignored]  <script>...   <-- IGNORED_NODE in mirror
//     [addedSet] <div data-i="b"/>
//   </parent>

import { afterEach, describe, expect, it } from 'vitest';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('mutation drain — forward walk skips IGNORED_NODE siblings (#5244 fasyy612)', () => {
  let stop: (() => void) | undefined;

  afterEach(() => {
    if (stop) stop();
    stop = undefined;
    document.body.innerHTML = '';
  });

  it('serializes an addedSet sibling that sits after an ignored script node', async () => {
    document.body.innerHTML = '<main id="fixture"></main>';
    const fixture = document.getElementById('fixture')!;

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

    // Batch: new-element, ignored-script, new-element. The three nodes
    // are appended in one synchronous turn so they land in the same
    // addedSet batch — the drain has to walk past the script.
    const first = document.createElement('div');
    first.setAttribute('data-i', 'a');
    const ignored = document.createElement('script');
    ignored.setAttribute('data-i', 'ignored');
    ignored.textContent = '/* no-op */';
    const second = document.createElement('div');
    second.setAttribute('data-i', 'b');

    const frag = document.createDocumentFragment();
    frag.appendChild(first);
    frag.appendChild(ignored);
    frag.appendChild(second);
    fixture.appendChild(frag);

    await settle();
    await settle();

    // Collect add payloads emitted after the batch.
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

    // Both new <div>s must have shipped. The pre-fix walk would stop at
    // the ignored script and leave `second` undrained.
    expect(addedAttrs).toContain('a');
    expect(addedAttrs).toContain('b');

    // addedSet must be fully drained for the batch to be a success.
    const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
    expect((buffer as unknown as { addedSet: Set<Node> }).addedSet.size).toBe(0);
  });

  it('still terminates when the sibling after the ignored node is NOT in addedSet', async () => {
    // Pre-existing element next to the ignored script — the drain
    // must notice it is NOT in addedSet and stop walking, not keep
    // probing forever.
    document.body.innerHTML =
      '<main id="fixture"><div id="pre-existing"/></main>';
    const fixture = document.getElementById('fixture')!;

    const events: Array<{ type: number; data?: { adds?: unknown[] } }> = [];
    stop = record({
      slimDOMOptions: 'all',
      emit: (event) => {
        events.push(event as { type: number; data?: { adds?: unknown[] } });
      },
    });
    await settle();

    const preExisting = document.getElementById('pre-existing')!;
    const added = document.createElement('div');
    added.setAttribute('data-i', 'c');
    const ignored = document.createElement('script');
    ignored.textContent = '/* no-op */';

    // Insert added node, then the ignored script, between the start
    // and the pre-existing <div>. The walk forward from `added` must
    // skip the ignored node, find pre-existing (NOT in addedSet),
    // and terminate.
    fixture.insertBefore(added, preExisting);
    fixture.insertBefore(ignored, preExisting);

    await settle();
    await settle();

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
    expect(addedAttrs).toContain('c');

    const buffer = mutationBuffers.find((b) => b.bufferDoc() === document)!;
    expect((buffer as unknown as { addedSet: Set<Node> }).addedSet.size).toBe(0);
  });
});
