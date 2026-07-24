import type { CanvasMaskRegion, CanvasMasking } from '@posthog/rrweb-types';

export const SKIP_FRAME = 'skip-frame' as const;

export type FrameMaskResult =
  | CanvasMaskRegion[]
  | typeof SKIP_FRAME
  | undefined;

// regions come back in CSS pixels relative to the canvas and are scaled to
// capture-resolution pixels here
export function computeFrameMaskRegions(
  masking: CanvasMasking | undefined,
  canvas: HTMLCanvasElement,
  captureWidth: number,
  captureHeight: number,
  displayWidth: number,
  displayHeight: number,
): FrameMaskResult {
  if (!masking || typeof masking.regionsFn !== 'function') {
    return undefined;
  }

  let regions: CanvasMaskRegion[] | null | undefined;
  try {
    regions = masking.regionsFn(canvas);
  } catch {
    return SKIP_FRAME;
  }

  if (regions === undefined) {
    return undefined;
  }
  if (!Array.isArray(regions) || !regions.every(isValidRegion)) {
    return SKIP_FRAME;
  }

  const sx = captureWidth / displayWidth;
  const sy = captureHeight / displayHeight;
  return regions.map((r) => {
    const left = Math.floor(r.x * sx);
    const top = Math.floor(r.y * sy);
    return {
      x: left,
      y: top,
      width: Math.ceil((r.x + r.width) * sx) - left,
      height: Math.ceil((r.y + r.height) * sy) - top,
    };
  });
}

function isValidRegion(r: unknown): r is CanvasMaskRegion {
  if (typeof r !== 'object' || r === null) {
    return false;
  }
  const { x, y, width, height } = r as CanvasMaskRegion;
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= 0 &&
    height >= 0
  );
}
