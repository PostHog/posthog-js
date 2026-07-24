import type { CanvasMaskRegion, CanvasMasking } from '@posthog/rrweb-types';

// regions come back in CSS pixels relative to the canvas and are scaled to
// capture-resolution pixels here. when masking is required, any frame whose
// regions could not be computed is covered entirely rather than shipped
// unmasked (fail closed).
export function computeFrameMaskRegions(
  masking: CanvasMasking | undefined,
  canvas: HTMLCanvasElement,
  captureWidth: number,
  captureHeight: number,
  displayWidth: number,
  displayHeight: number,
): CanvasMaskRegion[] | undefined {
  if (!masking) {
    return undefined;
  }
  if (typeof masking.regionsFn === 'function') {
    try {
      const regions = masking.regionsFn(canvas);
      if (Array.isArray(regions) && regions.every(isValidRegion)) {
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
    } catch {
      // a broken provider must not break capture; fall through to `required`
    }
  }
  return masking.required === true
    ? [{ x: 0, y: 0, width: captureWidth, height: captureHeight }]
    : undefined;
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
    Number.isFinite(height)
  );
}
