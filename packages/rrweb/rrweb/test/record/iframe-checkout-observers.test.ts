/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventType,
  IncrementalSource,
  MouseInteractions,
} from '@posthog/rrweb-types';
import type { eventWithTime } from '@posthog/rrweb-types';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';
import * as observers from '../../src/record/observer';
import { IframeManager } from '../../src/record/iframe-manager';

describe('same-origin iframe observers across checkouts', () => {
  let stop: (() => void) | undefined;
  let events: eventWithTime[];

  beforeEach(() => {
    // Keep jsdom from retaining WebKit helper iframes in the buffer count.
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 Chrome/125.0.0.0 Safari/537.36',
    );
  });

  afterEach(() => {
    stop?.();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  async function start() {
    const iframe = document.createElement('iframe');
    const loaded = new Promise((resolve) =>
      iframe.addEventListener('load', resolve, { once: true }),
    );
    document.body.appendChild(iframe);
    await loaded;
    iframe.contentDocument!.body.innerHTML = '<span>original</span>';
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete');
    events = [];
    stop = record({ emit: (event) => events.push(event) });
    await vi.waitFor(() => expect(mutationBuffers).toHaveLength(2));
    return iframe;
  }

  it('keeps one mutation buffer for the same iframe document', async () => {
    await start();
    for (let i = 0; i < 3; i++) {
      record.takeFullSnapshot(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mutationBuffers).toHaveLength(2);
    }
    stop!();
    stop = undefined;
    expect(mutationBuffers).toHaveLength(0);
  });

  it('emits each iframe text mutation once after multiple checkouts', async () => {
    const iframe = await start();
    for (let i = 0; i < 3; i++) {
      record.takeFullSnapshot(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    events = [];
    iframe.contentDocument!.querySelector('span')!.firstChild!.textContent =
      'changed';
    await new Promise((resolve) => setTimeout(resolve, 0));
    const textEvents = events.filter(
      (event) =>
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation &&
        event.data.texts.some((text) => text.value === 'changed'),
    );
    expect(textEvents).toHaveLength(1);
  });

  it('observes a document again after its pagehide cleanup', async () => {
    const iframe = await start();
    iframe.contentWindow!.dispatchEvent(new Event('pagehide'));
    expect(mutationBuffers).toHaveLength(1);
    record.takeFullSnapshot(true);
    await vi.waitFor(() => expect(mutationBuffers).toHaveLength(2));
    events = [];
    iframe.contentDocument!.querySelector('span')!.firstChild!.textContent =
      'restored';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      events.some(
        (event) =>
          event.type === EventType.IncrementalSnapshot &&
          event.data.source === IncrementalSource.Mutation &&
          event.data.texts.some((text) => text.value === 'restored'),
      ),
    ).toBe(true);
  });

  it.each([false, true])(
    'cleans up the first no-id attachment before reattaching and removing an iframe (rewrite: %s)',
    async (rewrite) => {
      const iframeCleanups: ReturnType<typeof vi.fn>[] = [];
      const initObservers = observers.initObservers;
      vi.spyOn(observers, 'initObservers').mockImplementation(
        (options, hooks) => {
          const cleanup = vi.fn(initObservers(options, hooks));
          if (options.doc !== document) iframeCleanups.push(cleanup);
          return cleanup;
        },
      );
      const addLoadListener = IframeManager.prototype.addLoadListener;
      let firstAttach = true;
      vi.spyOn(IframeManager.prototype, 'addLoadListener').mockImplementation(
        function (listener) {
          addLoadListener.call(this, (iframe) => {
            if (!firstAttach) return listener(iframe);
            firstAttach = false;
            const getId = vi
              .spyOn(record.mirror, 'getId')
              .mockReturnValueOnce(-1);
            try {
              return listener(iframe);
            } finally {
              getId.mockRestore();
            }
          });
        },
      );

      const iframe = await start();
      expect(iframeCleanups).toHaveLength(1);
      expect(record.mirror.getId(iframe)).not.toBe(-1);
      if (rewrite) {
        const doc = iframe.contentDocument!;
        doc.open();
        doc.write(
          '<!DOCTYPE html><html><body><span>rewritten</span></body></html>',
        );
        doc.close();
        expect(iframe.contentDocument).toBe(doc);
      }
      record.takeFullSnapshot(true);
      await vi.waitFor(() => expect(iframeCleanups).toHaveLength(2));
      expect(iframeCleanups[0]).toHaveBeenCalledOnce();
      expect(iframeCleanups[1]).not.toHaveBeenCalled();
      expect(mutationBuffers).toHaveLength(2);

      for (let i = 0; i < 3; i++) {
        record.takeFullSnapshot(true);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(iframeCleanups).toHaveLength(2);
      events = [];
      iframe.contentDocument!.querySelector('span')!.click();
      iframe.contentDocument!.querySelector('span')!.click();
      expect(
        events.filter(
          (event) =>
            event.type === EventType.IncrementalSnapshot &&
            event.data.source === IncrementalSource.MouseInteraction &&
            event.data.type === MouseInteractions.Click,
        ),
      ).toHaveLength(2);

      iframe.remove();
      await vi.waitFor(() => expect(iframeCleanups[1]).toHaveBeenCalledOnce());
      expect(iframeCleanups[0]).toHaveBeenCalledOnce();
      stop!();
      stop = undefined;
      expect(iframeCleanups[0]).toHaveBeenCalledOnce();
      expect(iframeCleanups[1]).toHaveBeenCalledOnce();
      expect(mutationBuffers).toHaveLength(0);
    },
  );
});
