import type { ICanvas } from '@posthog/rrweb-snapshot';
import type {
  blockClass,
  IWindow,
  listenerHandler,
} from '@posthog/rrweb-types';
import { isBlocked } from '../../../utils';
import { patch } from '@posthog/rrweb-utils';

const WEBGL_CONTEXT_NAMES = ['webgl', 'webgl2'];

type GPUCanvasConfigurationLike = {
  usage?: number;
};

type GPUTextureUsageLike = {
  COPY_SRC: number;
  RENDER_ATTACHMENT: number;
};

type WebGPUCanvasLike = {
  nodeType?: number;
  __context?: string;
};

type WebGPUCanvasContextLike = {
  canvas?: unknown;
  configure?: (configuration: GPUCanvasConfigurationLike) => void;
};

function getNormalizedContextName(contextType: string) {
  return contextType === 'experimental-webgl' ? 'webgl' : contextType;
}

function getRequiredWebGPUTextureUsage(win: IWindow) {
  const textureUsage = (
    win as IWindow & { GPUTextureUsage?: GPUTextureUsageLike }
  ).GPUTextureUsage;

  if (!textureUsage) {
    return null;
  }

  return textureUsage.COPY_SRC | textureUsage.RENDER_ATTACHMENT;
}

function getCanvasFromWebGPUContext(
  context: WebGPUCanvasContextLike,
): WebGPUCanvasLike | null {
  const { canvas } = context;

  if (!canvas || typeof canvas !== 'object') {
    return null;
  }

  return canvas as WebGPUCanvasLike;
}

function isCanvasNode(
  canvas: WebGPUCanvasLike,
): canvas is ICanvas | HTMLCanvasElement {
  return 'nodeType' in canvas;
}

function initCanvasWebGPUContextObserver(
  win: IWindow,
  blockClass: blockClass,
  blockSelector: string | null,
): listenerHandler | undefined {
  const GPUCanvasContext = (
    win as IWindow & {
      GPUCanvasContext?: {
        prototype?: WebGPUCanvasContextLike;
      };
    }
  ).GPUCanvasContext;

  if (
    !GPUCanvasContext?.prototype ||
    typeof GPUCanvasContext.prototype.configure !== 'function'
  ) {
    return;
  }

  return patch(
    GPUCanvasContext.prototype,
    'configure',
    function (
      original: (
        this: WebGPUCanvasContextLike,
        configuration: GPUCanvasConfigurationLike,
      ) => void,
    ) {
      return function (
        this: WebGPUCanvasContextLike,
        configuration: GPUCanvasConfigurationLike,
      ) {
        const canvas = getCanvasFromWebGPUContext(this);

        if (
          !canvas ||
          (isCanvasNode(canvas) &&
            isBlocked(canvas, blockClass, blockSelector, true))
        ) {
          return original.call(this, configuration);
        }

        if (isCanvasNode(canvas) && !('__context' in canvas)) {
          (canvas as ICanvas).__context = 'webgpu';
        }

        const requiredUsage = getRequiredWebGPUTextureUsage(win);
        if (requiredUsage === null || !configuration) {
          return original.call(this, configuration);
        }

        return original.call(this, {
          ...configuration,
          // WebGPU does not implicitly keep RENDER_ATTACHMENT when usage is set,
          // so include both flags needed for drawing and snapshot reads.
          usage:
            typeof configuration.usage === 'number'
              ? configuration.usage | requiredUsage
              : requiredUsage,
        });
      };
    },
  );
}

export default function initCanvasContextObserver(
  win: IWindow,
  blockClass: blockClass,
  blockSelector: string | null,
  setPreserveDrawingBufferToTrue: boolean,
): listenerHandler {
  const handlers: listenerHandler[] = [];
  try {
    if (setPreserveDrawingBufferToTrue) {
      const restoreWebGPUConfigureHandler = initCanvasWebGPUContextObserver(
        win,
        blockClass,
        blockSelector,
      );
      if (restoreWebGPUConfigureHandler) {
        handlers.push(restoreWebGPUConfigureHandler);
      }
    }

    const restoreHandler = patch(
      win.HTMLCanvasElement.prototype,
      'getContext',
      function (
        original: (
          this: ICanvas | HTMLCanvasElement,
          contextType: string,
          ...args: Array<unknown>
        ) => void,
      ) {
        return function (
          this: ICanvas | HTMLCanvasElement,
          contextType: string,
          ...args: Array<unknown>
        ) {
          const ctxName = getNormalizedContextName(contextType);
          if (!isBlocked(this, blockClass, blockSelector, true)) {
            if (!('__context' in this)) (this as ICanvas).__context = ctxName;

            if (
              setPreserveDrawingBufferToTrue &&
              WEBGL_CONTEXT_NAMES.includes(ctxName)
            ) {
              if (args[0] && typeof args[0] === 'object') {
                const contextAttributes = args[0] as WebGLContextAttributes;
                if (!contextAttributes.preserveDrawingBuffer) {
                  contextAttributes.preserveDrawingBuffer = true;
                }
              } else {
                args.splice(0, 1, {
                  preserveDrawingBuffer: true,
                });
              }
            }
          }

          return original.apply(this, [contextType, ...args]);
        };
      },
    );
    handlers.push(restoreHandler);
  } catch {
    console.error('failed to patch HTMLCanvasElement.prototype.getContext');
  }
  return () => {
    handlers.forEach((h) => h());
  };
}
