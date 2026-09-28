/**
 * @vitest-environment jsdom
 */
import { polyfillWebGLGlobals } from '../utils';
polyfillWebGLGlobals();

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import initCanvas2DMutationObserver from '../../src/record/observers/canvas/2d';
import initCanvasWebGLMutationObserver from '../../src/record/observers/canvas/webgl';

function taintedCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.toDataURL = () => {
    throw new DOMException('tainted canvas', 'SecurityError');
  };
  return canvas;
}

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('canvas mutation with an unreadable canvas argument', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips the 2D mutation and still records the next one', async () => {
    const original = vi.fn();
    class Fake2DContext {
      constructor(public canvas: HTMLCanvasElement) {}
      drawImage(...args: unknown[]) {
        original(...args);
      }
    }
    const cb = vi.fn();
    const restore = initCanvas2DMutationObserver(
      cb,
      { CanvasRenderingContext2D: Fake2DContext } as never,
      'rr-block',
      null,
      {},
    );

    const ctx = new Fake2DContext(document.createElement('canvas'));
    ctx.drawImage(taintedCanvas(), 0, 0, 10, 10);
    ctx.drawImage(document.createElement('img'), 0, 0);
    await nextTask();

    expect(original).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][1]).toMatchObject({
      property: 'drawImage',
      args: [{ rr_type: 'HTMLImageElement' }, 0, 0],
    });
    restore();
  });

  it('skips the WebGL mutation without throwing into the page call', () => {
    class FakeWebGLContext {
      constructor(public canvas: HTMLCanvasElement) {}
      texImage2D() {
        return 'page result';
      }
    }
    const cb = vi.fn();
    const restore = initCanvasWebGLMutationObserver(
      cb,
      { WebGLRenderingContext: FakeWebGLContext } as never,
      'rr-block',
      null,
      {},
    );

    const gl = new FakeWebGLContext(document.createElement('canvas'));
    const texImage2D = gl.texImage2D as (...args: unknown[]) => unknown;

    expect(texImage2D.call(gl, 0, 0, 0, 0, 0, taintedCanvas())).toBe(
      'page result',
    );
    expect(cb).not.toHaveBeenCalled();
    restore();
  });
});
