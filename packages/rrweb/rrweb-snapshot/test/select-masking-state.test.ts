/** @vitest-environment jsdom */
import { NodeType } from '@posthog/rrweb-types';
import type { serializedElementNodeWithId } from '@posthog/rrweb-types';
import { Mirror, updateSelectMaskingState } from '../src';

it.each([true, null] as const)(
  'updates live masking without mutating snapshot metadata (%s)',
  (marker) => {
    const select = document.createElement('select');
    const mirror = new Mirror();
    const snapshot: serializedElementNodeWithId = {
      id: 1,
      type: NodeType.Element,
      tagName: 'select',
      attributes: { rr_maskedSelect: marker },
      childNodes: [],
    };
    mirror.add(select, snapshot);
    updateSelectMaskingState(select, mirror, marker === null);
    expect(mirror.getMeta(select)).toMatchObject({
      attributes: { rr_maskedSelect: marker === null ? true : null },
    });
    expect(snapshot.attributes.rr_maskedSelect).toBe(marker);
    expect(mirror.getId(select)).toBe(1);
    expect(mirror.getNode(1)).toBe(select);
  },
);

it('leaves legacy snapshots without a masking marker unchanged', () => {
  const select = document.createElement('select');
  const mirror = new Mirror();
  const snapshot: serializedElementNodeWithId = {
    id: 1,
    type: NodeType.Element,
    tagName: 'select',
    attributes: { value: 'public' },
    childNodes: [],
  };
  mirror.add(select, snapshot);
  updateSelectMaskingState(select, mirror, true);
  expect(mirror.getMeta(select)).toBe(snapshot);
  expect(snapshot.attributes).toEqual({ value: 'public' });
});
