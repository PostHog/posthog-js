import { describe, expect, it } from 'vitest';
import type { CanvasMaskRegion } from '@posthog/rrweb-types';
import { computeFrameMaskRegions, SKIP_FRAME } from '../../src/record/observers/canvas/canvas-mask';

const CANVAS = {} as HTMLCanvasElement;
const REGION = { x: 10, y: 20, width: 30, height: 40 };

const unanswerableProviders: [string, { regionsFn?: () => CanvasMaskRegion[] | null }][] = [
  ['a throwing provider', { regionsFn: () => { throw new Error('boom'); } }],
  ['a provider returning a non-array', { regionsFn: () => null }],
  ['a provider returning an empty region object', { regionsFn: () => [{}] as CanvasMaskRegion[] }],
  [
    'a provider returning a region missing a field',
    { regionsFn: () => [{ x: 1, y: 2, width: 3 }] as CanvasMaskRegion[] },
  ],
  [
    'a provider returning a non-numeric region field',
    { regionsFn: () => [{ x: 'a', y: 0, width: 10, height: 10 }] as unknown as CanvasMaskRegion[] },
  ],
  [
    'a provider mixing valid and malformed regions',
    { regionsFn: () => [REGION, {}] as CanvasMaskRegion[] },
  ],
  [
    'a provider returning a region with negative extents',
    { regionsFn: () => [{ x: 10, y: 10, width: -5, height: -5 }] },
  ],
];

describe('computeFrameMaskRegions', () => {
  it('returns undefined without masking config', () => {
    expect(
      computeFrameMaskRegions(undefined, CANVAS, 100, 50, 100, 50),
    ).toBeUndefined();
  });

  it('scales regions from display to capture pixels', () => {
    const result = computeFrameMaskRegions(
      { regionsFn: () => [REGION] },
      CANVAS,
      50,
      25,
      100,
      50,
    );
    expect(result).toEqual([{ x: 5, y: 10, width: 15, height: 20 }]);
  });

  it('rounds scaled regions outward to integer pixels', () => {
    const result = computeFrameMaskRegions(
      { regionsFn: () => [REGION] },
      CANVAS,
      33,
      33,
      100,
      100,
    );
    expect(result).toEqual([{ x: 3, y: 6, width: 11, height: 14 }]);
  });

  it('drops zero-area regions, keeping the rest', () => {
    const result = computeFrameMaskRegions(
      { regionsFn: () => [{ x: 5.5, y: 0, width: 0, height: 40 }, REGION] },
      CANVAS,
      50,
      25,
      100,
      50,
    );
    expect(result).toEqual([{ x: 5, y: 10, width: 15, height: 20 }]);
  });

  it('treats a list of only zero-area regions as nothing to mask', () => {
    expect(
      computeFrameMaskRegions(
        {
          regionsFn: () => [
            { x: 5.5, y: 0, width: 0, height: 40 },
            { x: 0, y: 5.5, width: 40, height: 0 },
          ],
        },
        CANVAS,
        50,
        25,
        100,
        50,
      ),
    ).toEqual([]);
  });

  it('passes the canvas through to the provider', () => {
    let seen: HTMLCanvasElement | null = null;
    computeFrameMaskRegions(
      {
        regionsFn: (canvas) => {
          seen = canvas;
          return [];
        },
      },
      CANVAS,
      100,
      50,
      100,
      50,
    );
    expect(seen).toBe(CANVAS);
  });

  it('keeps a successfully computed empty region list', () => {
    expect(
      computeFrameMaskRegions(
        { regionsFn: () => [] },
        CANVAS,
        100,
        50,
        100,
        50,
      ),
    ).toEqual([]);
  });

  it('returns undefined without a provider', () => {
    expect(
      computeFrameMaskRegions({}, CANVAS, 50, 25, 100, 50),
    ).toBeUndefined();
  });

  it('returns undefined when the provider is not configured for this frame', () => {
    expect(
      computeFrameMaskRegions(
        { regionsFn: () => undefined },
        CANVAS,
        50,
        25,
        100,
        50,
      ),
    ).toBeUndefined();
  });

  it.each(unanswerableProviders)('skips the frame with %s', (_name, masking) => {
    expect(
      computeFrameMaskRegions(masking, CANVAS, 50, 25, 100, 50),
    ).toBe(SKIP_FRAME);
  });
});
