/**
 * @vitest-environment jsdom
 */
import { vi } from 'vitest';
import { polyfillWebGLGlobals } from '../utils';
polyfillWebGLGlobals();

import canvasMutation from '../../src/replay/canvas';
import { CanvasContext } from '@posthog/rrweb-types';
import type { canvasMutationData, eventWithTime } from '@posthog/rrweb-types';
import type { Replayer } from '../../src/replay';

// A canvas frame is recorded as clearRect + drawImage at the display size, which the browser
// reads in the canvas coordinate space (its width/height attributes). Straight playback and a
// seek reach the same instant with different attributes: a seek applies the final width/height
// first, then replays the queued frames. Both playback paths funnel through this dispatcher, so
// it restores the coordinate space the frame was captured against before drawing. These tests
// prove a canvas left at a different size (as a seek does) converges on the same size a straight
// play would show.
describe('canvas frame size on replay', () => {
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockImplementation(
      () =>
        ({ clearRect: vi.fn(), drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D,
    );
    (global as any).createImageBitmap = vi.fn(() =>
      Promise.resolve({ width: 400, height: 300 } as unknown as ImageBitmap),
    );
  });

  afterEach(() => vi.clearAllMocks());

  function frame(): canvasMutationData {
    return {
      source: 0,
      id: 1,
      type: CanvasContext['2D'],
      // the display size the frame was drawn back to
      displayWidth: 400,
      displayHeight: 300,
      // the coordinate space it was captured against
      canvasWidth: 800,
      canvasHeight: 600,
      commands: [{ property: 'clearRect', args: [0, 0, 400, 300] }],
    } as unknown as canvasMutationData;
  }

  async function apply(target: HTMLCanvasElement, mutation: canvasMutationData) {
    await canvasMutation({
      event: {} as eventWithTime,
      mutation,
      target,
      imageMap: new Map(),
      canvasEventMap: new Map(),
      errorHandler: () => {},
    });
  }

  it('restores the captured coordinate space when a seek left the canvas at the final size', async () => {
    // a seek writes the final width/height before replaying the queued frames
    canvas.width = 200;
    canvas.height = 200;

    await apply(canvas, frame());

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it('renders the same size whether reached by a straight play or a seek', async () => {
    const straight = document.createElement('canvas');
    vi.spyOn(straight, 'getContext').mockImplementation(
      () =>
        ({ clearRect: vi.fn(), drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D,
    );
    // straight playback already resized the canvas as the frame was captured
    straight.width = 800;
    straight.height = 600;
    // a seek left it at the final size instead
    canvas.width = 200;
    canvas.height = 200;

    await apply(straight, frame());
    await apply(canvas, frame());

    expect(canvas.width).toBe(straight.width);
    expect(canvas.height).toBe(straight.height);
  });

  it('leaves the canvas size untouched for legacy frames without a coordinate space', async () => {
    canvas.width = 200;
    canvas.height = 200;
    const legacy = frame();
    delete (legacy as { canvasWidth?: number }).canvasWidth;
    delete (legacy as { canvasHeight?: number }).canvasHeight;

    await apply(canvas, legacy);

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(200);
  });
});
