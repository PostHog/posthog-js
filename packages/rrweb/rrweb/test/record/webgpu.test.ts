import * as path from 'path';
import type * as puppeteer from 'puppeteer';
import { describe, expect, it, vi } from 'vitest';
import type { recordOptions } from '../../src/types';
import {
  listenerHandler,
  eventWithTime,
  EventType,
  IncrementalSource,
  CanvasContext,
} from '@posthog/rrweb-types';
import { launchPuppeteer, waitForCondition } from '../utils';

interface ISuite {
  browser: puppeteer.Browser;
  page: puppeteer.Page;
  events: eventWithTime[];
}

interface IWindow extends Window {
  rrweb: {
    record: (
      options: recordOptions<eventWithTime>,
    ) => listenerHandler | undefined;
  };
  emit: (e: eventWithTime) => undefined;
}

const setup = function (this: ISuite, content: string): ISuite {
  const ctx = {} as ISuite;

  beforeAll(async () => {
    ctx.browser = await launchPuppeteer({
      args: ['--no-sandbox', '--enable-unsafe-webgpu'],
    });
  });

  beforeEach(async () => {
    ctx.page = await ctx.browser.newPage();
    await ctx.page.goto('about:blank');
    await ctx.page.setContent(content);

    await ctx.page.evaluate(() => {
      class FakeGPUCanvasContext {
        constructor(
          public canvas: HTMLCanvasElement & {
            __lastWebGPUConfigure?: { usage?: number };
            __fakeWebGPUContext?: FakeGPUCanvasContext;
          },
        ) {}

        configure(configuration: { usage?: number }) {
          this.canvas.__lastWebGPUConfigure = configuration;
        }
      }

      (
        globalThis as typeof globalThis & {
          GPUTextureUsage?: {
            COPY_SRC: number;
            TEXTURE_BINDING: number;
            RENDER_ATTACHMENT: number;
          };
          GPUCanvasContext?: typeof FakeGPUCanvasContext;
          __originalCreateImageBitmap?: typeof createImageBitmap;
          __preExistingWebGPUContext?: FakeGPUCanvasContext;
        }
      ).GPUTextureUsage = {
        COPY_SRC: 0x01,
        TEXTURE_BINDING: 0x04,
        RENDER_ATTACHMENT: 0x10,
      };
      (
        globalThis as typeof globalThis & {
          GPUCanvasContext?: typeof FakeGPUCanvasContext;
        }
      ).GPUCanvasContext = FakeGPUCanvasContext;

      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        contextType: string,
        ...args: unknown[]
      ) {
        if (contextType === 'webgpu') {
          const canvas = this as HTMLCanvasElement & {
            __lastWebGPUConfigure?: { usage?: number };
            __fakeWebGPUContext?: FakeGPUCanvasContext;
          };

          if (!canvas.__fakeWebGPUContext) {
            canvas.__fakeWebGPUContext = new FakeGPUCanvasContext(canvas);
          }

          return canvas.__fakeWebGPUContext as unknown as RenderingContext;
        }

        return originalGetContext.call(this, contextType, ...args);
      };

      const canvas = document.getElementById('canvas') as HTMLCanvasElement & {
        __fakeWebGPUContext?: FakeGPUCanvasContext;
      };
      (
        globalThis as typeof globalThis & {
          __preExistingWebGPUContext?: FakeGPUCanvasContext;
        }
      ).__preExistingWebGPUContext = canvas.getContext(
        'webgpu',
      ) as unknown as FakeGPUCanvasContext;

      const originalCreateImageBitmap = createImageBitmap.bind(window);
      (
        globalThis as typeof globalThis & {
          __originalCreateImageBitmap?: typeof createImageBitmap;
        }
      ).__originalCreateImageBitmap = originalCreateImageBitmap;
      window.createImageBitmap = async (source) => {
        const sourceCanvas = source as HTMLCanvasElement & {
          __lastWebGPUConfigure?: { usage?: number };
          __fakeWebGPUContext?: FakeGPUCanvasContext;
        };

        if (sourceCanvas.__fakeWebGPUContext) {
          const requiredUsage =
            GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT;
          const configuredUsage = sourceCanvas.__lastWebGPUConfigure?.usage;

          if (
            typeof configuredUsage !== 'number' ||
            (configuredUsage & requiredUsage) !== requiredUsage
          ) {
            throw new Error('WebGPU canvas missing snapshot-safe usage');
          }
        }

        const bitmapSourceCanvas = document.createElement('canvas');
        bitmapSourceCanvas.width = 4;
        bitmapSourceCanvas.height = 4;
        const sourceContext = bitmapSourceCanvas.getContext('2d')!;
        sourceContext.fillStyle = 'rgb(0, 128, 0)';
        sourceContext.fillRect(0, 0, 4, 4);
        return await originalCreateImageBitmap(bitmapSourceCanvas);
      };
    });

    await ctx.page.addScriptTag({
      path: path.resolve(__dirname, '../../dist/rrweb.umd.cjs'),
    });
    ctx.events = [];
    await ctx.page.exposeFunction('emit', (e: eventWithTime) => {
      if (e.type === EventType.DomContentLoaded || e.type === EventType.Load) {
        return;
      }
      ctx.events.push(e);
    });

    await ctx.page.evaluate(() => {
      const { record } = (window as unknown as IWindow).rrweb;
      record({
        recordCanvas: true,
        sampling: {
          canvas: 60,
        },
        emit: (window as unknown as IWindow).emit,
      });
    });
  });

  afterEach(async () => {
    await ctx.page.close();
  });

  afterAll(async () => {
    await ctx.browser?.close();
  });

  return ctx;
};

describe('record webgpu snapshots', function (this: ISuite) {
  vi.setConfig({ testTimeout: 100_000 });

  const ctx: ISuite = setup.call(
    this,
    `
      <!DOCTYPE html>
      <html>
        <body>
          <canvas id="canvas" width="8" height="8" style="width: 8px; height: 8px;"></canvas>
        </body>
      </html>
    `,
  );

  it('records a replayable snapshot event for webgpu contexts created before recording starts', async () => {
    const { configuredUsage, contextName } = await ctx.page.evaluate(() => {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement & {
        __lastWebGPUConfigure?: { usage?: number };
        __context?: string;
      };
      const textureUsage = (
        globalThis as typeof globalThis & {
          GPUTextureUsage: {
            COPY_SRC: number;
            TEXTURE_BINDING: number;
            RENDER_ATTACHMENT: number;
          };
          __preExistingWebGPUContext?: {
            configure: (configuration: { usage?: number }) => void;
          };
        }
      ).GPUTextureUsage;

      const context = (
        globalThis as typeof globalThis & {
          __preExistingWebGPUContext?: {
            configure: (configuration: { usage?: number }) => void;
          };
        }
      ).__preExistingWebGPUContext!;
      context.configure({
        usage: textureUsage.TEXTURE_BINDING,
      });

      return {
        configuredUsage: canvas.__lastWebGPUConfigure?.usage ?? null,
        contextName: canvas.__context ?? null,
      };
    });

    expect(configuredUsage).toBe(0x15);
    expect(contextName).toBe('webgpu');

    const snapshotEvent = await waitForCondition(() =>
      ctx.events.find(
        (event) =>
          event.type === EventType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.CanvasMutation &&
          event.data.type === CanvasContext['2D'],
      ),
    );

    expect(snapshotEvent).toMatchObject({
      data: {
        source: IncrementalSource.CanvasMutation,
        type: CanvasContext['2D'],
        displayWidth: 8,
        displayHeight: 8,
        commands: [
          {
            property: 'clearRect',
          },
          {
            property: 'drawImage',
          },
        ],
      },
    });
  });
});
