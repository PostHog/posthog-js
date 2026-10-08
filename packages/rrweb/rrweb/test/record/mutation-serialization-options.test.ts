// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as snapshot from '@posthog/rrweb-snapshot';
import record from '../../src/record';
import type { eventWithTime } from '@posthog/rrweb-types';

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('mutation serialization options', () => {
  let stop: (() => void) | undefined;
  let events: eventWithTime[];

  beforeEach(() => {
    document.body.innerHTML = '<main id="fixture"></main>';
    events = [];
  });

  afterEach(() => {
    stop?.();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('allocates one options object per emission instead of per added node', async () => {
    const serialize = vi.spyOn(snapshot, 'serializeNodeWithId');
    stop = record({ emit: (event) => events.push(event) });
    await settle();
    serialize.mockClear();

    document.getElementById('fixture')!.innerHTML =
      '<div><span>first</span><b>second</b></div>'.repeat(100);
    await settle();

    const options = serialize.mock.calls
      .filter(
        ([node, options]) =>
          options.newlyAddedElement &&
          document.getElementById('fixture')!.contains(node),
      )
      .map(([, options]) => options);
    expect(options.length).toBeGreaterThan(100);
    expect(new Set(options).size).toBe(1);
    expect(new Set(options.map((options) => options.onSerialize)).size).toBe(1);

    serialize.mockClear();
    document.getElementById('fixture')!.innerHTML = '<p>next batch</p>';
    await settle();
    const nextOptions = serialize.mock.calls
      .filter(
        ([node, options]) =>
          options.newlyAddedElement &&
          document.getElementById('fixture')!.contains(node),
      )
      .map(([, options]) => options);
    expect(nextOptions.length).toBeGreaterThan(0);
    expect(new Set(nextOptions).size).toBe(1);
    expect(nextOptions[0]).not.toBe(options[0]);
  });

  it('does not share node-specific masking state between siblings or batches', async () => {
    const serialize = vi.spyOn(snapshot, 'serializeNodeWithId');
    const maskTextFn = vi.fn(() => '[MASKED]');
    stop = record({
      emit: (event) => events.push(event),
      maskTextClass: 'mask-me',
      maskTextFn,
      maskAllInputs: true,
    });
    await settle();
    events.length = 0;
    serialize.mockClear();

    document.getElementById('fixture')!.innerHTML =
      '<span class="mask-me">FIRST_PRIVATE</span><span>first public</span>' +
      '<input type="password" value="PRIVATE_PASSWORD">';
    await settle();
    let json = JSON.stringify(events);
    expect(json).toContain('[MASKED]');
    expect(json).toContain('first public');
    expect(json).not.toContain('FIRST_PRIVATE');
    expect(json).not.toContain('PRIVATE_PASSWORD');

    events.length = 0;
    document.getElementById('fixture')!.innerHTML =
      '<span>second public</span><span class="mask-me">SECOND_PRIVATE</span>';
    await settle();
    json = JSON.stringify(events);
    expect(json).toContain('second public');
    expect(json).toContain('[MASKED]');
    expect(json).not.toContain('SECOND_PRIVATE');
    expect(maskTextFn).toHaveBeenCalledWith('FIRST_PRIVATE', expect.anything());
    expect(maskTextFn).toHaveBeenCalledWith(
      'SECOND_PRIVATE',
      expect.anything(),
    );
    for (const [, options] of serialize.mock.calls) {
      if (options.newlyAddedElement) expect(options.needsMask).toBeUndefined();
    }
  });
});
