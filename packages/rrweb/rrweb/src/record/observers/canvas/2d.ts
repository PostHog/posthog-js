import {
  type blockClass,
  type CanvasArg,
  CanvasContext,
  type canvasManagerMutationCallback,
  type IWindow,
  type listenerHandler,
  type DataURLOptions,
} from '@posthog/rrweb-types';
import { hookSetter, isBlocked } from '../../../utils';
import { patch } from '@posthog/rrweb-utils';
import { serializeArgs } from './serialize-args';

export default function initCanvas2DMutationObserver(
  cb: canvasManagerMutationCallback,
  win: IWindow,
  blockClass: blockClass,
  blockSelector: string | null,
  dataURLOptions: DataURLOptions,
): listenerHandler {
  const handlers: listenerHandler[] = [];
  const props2D = Object.getOwnPropertyNames(
    win.CanvasRenderingContext2D.prototype,
  );
  for (const prop of props2D) {
    try {
      if (
        typeof win.CanvasRenderingContext2D.prototype[
          prop as keyof CanvasRenderingContext2D
        ] !== 'function'
      ) {
        continue;
      }
      const restoreHandler = patch(
        win.CanvasRenderingContext2D.prototype,
        prop,
        function (
          original: (
            this: CanvasRenderingContext2D,
            ...args: unknown[]
          ) => void,
        ) {
          return function (
            this: CanvasRenderingContext2D,
            ...args: Array<unknown>
          ) {
            if (!isBlocked(this.canvas, blockClass, blockSelector, true)) {
              // Using setTimeout as toDataURL can be heavy
              // and we'd rather not block the main thread
              setTimeout(() => {
                let recordArgs: CanvasArg[];
                try {
                  recordArgs = serializeArgs(args, win, this, dataURLOptions);
                } catch {
                  // an argument such as a tainted canvas cannot be read, so
                  // skip this mutation and let replay keep the last frame
                  return;
                }
                cb(this.canvas, {
                  type: CanvasContext['2D'],
                  property: prop,
                  args: recordArgs,
                });
              }, 0);
            }
            return original.apply(this, args);
          };
        },
      );
      handlers.push(restoreHandler);
    } catch {
      const hookHandler = hookSetter<CanvasRenderingContext2D>(
        win.CanvasRenderingContext2D.prototype,
        prop,
        {
          set(v) {
            if (!isBlocked(this.canvas, blockClass, blockSelector, true)) {
              cb(this.canvas, {
                type: CanvasContext['2D'],
                property: prop,
                args: [v],
                setter: true,
              });
            }
          },
        },
      );
      handlers.push(hookHandler);
    }
  }
  return () => {
    handlers.forEach((h) => h());
  };
}
