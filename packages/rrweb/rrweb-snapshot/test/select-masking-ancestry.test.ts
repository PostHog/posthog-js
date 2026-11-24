/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest';
import dom from '@posthog/rrweb-utils';
import snapshot, { cleanupSnapshot } from '../src/snapshot';
import { Mirror } from '../src/utils';

it.each(['span', 'option'])(
  'keeps opt-in ancestry work linear on a deep page without selects (%s)',
  (tag) => {
    const doc = document.implementation.createHTMLDocument();
    let parent = doc.body;
    for (let depth = 0; depth < 43; depth++) {
      const child = doc.createElement('div');
      parent.appendChild(child);
      parent = child;
    }
    if (tag === 'option') {
      const list = doc.createElement('datalist');
      parent.appendChild(list);
      parent = list;
    }
    parent.innerHTML = `<${tag}></${tag}>`.repeat(20_000);
    const nodeCount = doc.querySelectorAll('*').length;
    const parentReads = vi.spyOn(dom, 'parentNode');
    const ownerReads = vi.spyOn(dom, 'parentElement');
    const policy = vi.fn(() => 'masked' as const);
    try {
      cleanupSnapshot();
      const legacy = snapshot(doc, { mirror: new Mirror() });
      const legacyReads =
        parentReads.mock.calls.length + ownerReads.mock.calls.length;
      parentReads.mockClear();
      ownerReads.mockClear();
      cleanupSnapshot();
      const masked = snapshot(doc, {
        mirror: new Mirror(),
        selectMaskingFn: policy,
      });
      const extraReads =
        parentReads.mock.calls.length +
        ownerReads.mock.calls.length -
        legacyReads;
      expect(policy).not.toHaveBeenCalled();
      expect(masked).toEqual(legacy);
      expect(extraReads).toBeLessThan(nodeCount * 4);
    } finally {
      parentReads.mockRestore();
      ownerReads.mockRestore();
      cleanupSnapshot();
    }
  },
);

it('refreshes positive and negative option ownership after moves between captures', () => {
  const doc = document.implementation.createHTMLDocument();
  const privateSelect = doc.createElement('select');
  privateSelect.id = 'private';
  const publicSelect = doc.createElement('select');
  const list = doc.createElement('datalist');
  const wrapper = doc.createElement('div');
  const option = doc.createElement('option');
  option.textContent = 'static-choice';
  wrapper.append(option);
  list.append(wrapper);
  doc.body.append(privateSelect, publicSelect, list);
  const capture = () => {
    option.selected = true;
    return JSON.stringify(
      snapshot(doc, {
        mirror: new Mirror(),
        selectMaskingFn: (select) =>
          select.id === 'private' ? 'masked' : 'unmasked',
      }),
    );
  };
  expect(capture()).toContain('"selected":true');
  privateSelect.append(wrapper);
  expect(capture()).not.toContain('"selected":true');
  publicSelect.append(wrapper);
  expect(capture()).toContain('"selected":true');
  list.append(wrapper);
  expect(capture()).toContain('"selected":true');
});

it('refreshes clone ancestry and policy across captures and DOM moves', () => {
  const doc = document.implementation.createHTMLDocument();
  const select = doc.createElement('select');
  const button = doc.createElement('button');
  const content = doc.createElement('selectedcontent');
  const clone = doc.createElement('span');
  clone.textContent = 'clone-choice';
  const moved = doc.createElement('span');
  moved.textContent = 'moving-choice';
  const option = doc.createElement('option');
  option.textContent = 'static-label';
  content.append(clone);
  button.append(content);
  select.append(button, option);
  doc.body.append(select, moved);
  let masked = false;
  const capture = () =>
    JSON.stringify(
      snapshot(doc, {
        mirror: new Mirror(),
        selectMaskingFn: () => (masked ? 'masked' : 'unmasked'),
      }),
    );
  expect(capture()).toContain('clone-choice');
  masked = true;
  content.append(moved);
  const hidden = capture();
  expect(hidden).toContain('selectedcontent');
  expect(hidden).toContain('static-label');
  expect(hidden).not.toContain('clone-choice');
  expect(hidden).not.toContain('moving-choice');
  doc.body.append(moved);
  expect(capture()).toContain('moving-choice');
  masked = false;
  expect(capture()).toContain('clone-choice');
});
