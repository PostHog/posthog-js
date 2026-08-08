import type { Replayer } from '..';
import {
  CanvasContext,
  type canvasMutationCommand,
  type canvasMutationData,
  type canvasMutationParam,
} from '@posthog/rrweb-types';
import webglMutation from './webgl';
import canvas2DMutation from './2d';

export default async function canvasMutation({
  event,
  mutation,
  target,
  imageMap,
  canvasEventMap,
  errorHandler,
}: {
  event: Parameters<Replayer['applyIncremental']>[0];
  mutation: canvasMutationData;
  target: HTMLCanvasElement;
  imageMap: Replayer['imageMap'];
  canvasEventMap: Replayer['canvasEventMap'];
  errorHandler: Replayer['warnCanvasMutationFailed'];
}): Promise<void> {
  try {
    const precomputedMutation: canvasMutationParam =
      canvasEventMap.get(event) || mutation;

    const commands: canvasMutationCommand[] =
      'commands' in precomputedMutation
        ? precomputedMutation.commands
        : [precomputedMutation];

    if ([CanvasContext.WebGL, CanvasContext.WebGL2].includes(mutation.type)) {
      for (let i = 0; i < commands.length; i++) {
        const command = commands[i];
        await webglMutation({
          mutation: command,
          type: mutation.type,
          target,
          imageMap,
          errorHandler,
        });
      }
      return;
    }
    // default is '2d' for backwards compatibility (rrweb below 1.1.x)
    // Restore the coordinate space the frame was captured against before drawing it. The
    // drawImage command draws at the display size, which the browser reads in the canvas
    // coordinate space, so the scale depends on the width/height attributes at apply time. A
    // seek applies the final size first and then replays the queued frames, so without this it
    // renders a canvas whose coordinate space differs from its display size at the wrong scale.
    const { canvasWidth, canvasHeight } = precomputedMutation;
    if (
      typeof canvasWidth === 'number' &&
      typeof canvasHeight === 'number' &&
      (target.width !== canvasWidth || target.height !== canvasHeight)
    ) {
      // this also clears the canvas, which is fine because the frame repaints it in full
      target.width = canvasWidth;
      target.height = canvasHeight;
    }
    await canvas2DMutation({
      event,
      mutations: commands,
      target,
      imageMap,
      errorHandler,
    });
  } catch (error) {
    errorHandler(mutation, error);
  }
}
