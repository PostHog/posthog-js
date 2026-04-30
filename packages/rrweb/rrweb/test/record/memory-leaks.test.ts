import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import record from '../../src/record';
import { mutationBuffers } from '../../src/record/observer';
import { IframeManager } from '../../src/record/iframe-manager';
import type { eventWithTime } from '@posthog/rrweb-types';
import { createMirror } from '@posthog/rrweb-snapshot';

describe('memory leak prevention', () => {
  let dom: JSDOM;
  let document: Document;
  let window: Window & typeof globalThis;
  let events: eventWithTime[];

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'http://localhost',
    });
    document = dom.window.document;
    window = dom.window as unknown as Window & typeof globalThis;
    events = [];
    // Clear any existing mutation buffers
    mutationBuffers.length = 0;

    // Make window and all its properties global for record to use
    global.window = window as any;
    global.document = document as any;
    global.Element = dom.window.Element as any;
    global.HTMLElement = dom.window.HTMLElement as any;
    global.HTMLFormElement = dom.window.HTMLFormElement as any;
    global.HTMLImageElement = dom.window.HTMLImageElement as any;
    global.HTMLCanvasElement = dom.window.HTMLCanvasElement as any;
    global.HTMLAnchorElement = dom.window.HTMLAnchorElement as any;
    global.HTMLStyleElement = dom.window.HTMLStyleElement as any;
    global.HTMLLinkElement = dom.window.HTMLLinkElement as any;
    global.HTMLScriptElement = dom.window.HTMLScriptElement as any;
    global.HTMLMediaElement = dom.window.HTMLMediaElement as any;
    global.SVGElement = dom.window.SVGElement as any;
    global.Node = dom.window.Node as any;
    global.MutationObserver = dom.window.MutationObserver as any;
  });

  describe('mutationBuffers cleanup', () => {
    it('should clear mutationBuffers array after stopping recording', () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      // Start recording
      const stopRecording = record({
        emit,
      });

      // Verify buffers were created
      expect(mutationBuffers.length).toBeGreaterThan(0);
      const initialBufferCount = mutationBuffers.length;

      // Stop recording
      stopRecording?.();

      // Verify buffers array is cleared
      expect(mutationBuffers.length).toBe(0);
    });

    it('should not accumulate buffers across multiple recording sessions', () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      // First recording session
      const stop1 = record({ emit });
      const buffersAfterFirst = mutationBuffers.length;
      expect(buffersAfterFirst).toBeGreaterThan(0);
      stop1?.();
      expect(mutationBuffers.length).toBe(0);

      // Second recording session
      const stop2 = record({ emit });
      const buffersAfterSecond = mutationBuffers.length;
      expect(buffersAfterSecond).toBe(buffersAfterFirst);
      stop2?.();
      expect(mutationBuffers.length).toBe(0);

      // Third recording session
      const stop3 = record({ emit });
      const buffersAfterThird = mutationBuffers.length;
      expect(buffersAfterThird).toBe(buffersAfterFirst);
      stop3?.();
      expect(mutationBuffers.length).toBe(0);
    });

    it('should clear buffers even if recording had mutations', async () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      const stopRecording = record({ emit });

      // Trigger some DOM mutations
      const div = document.createElement('div');
      div.textContent = 'Test content';
      document.body.appendChild(div);

      // Wait for mutations to be processed
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mutationBuffers.length).toBeGreaterThan(0);

      // Stop recording
      stopRecording?.();

      // Verify buffers are cleared
      expect(mutationBuffers.length).toBe(0);
    });
  });

  describe('IframeManager cleanup', () => {
    it('should remove window message listener when recording stops', () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      // Start recording with cross-origin iframe support
      const stopRecording = record({
        emit,
        recordCrossOriginIframes: true,
      });

      // Verify message listener was added
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'message',
        expect.any(Function),
      );

      const messageHandler = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === 'message',
      )?.[1];

      // Stop recording
      stopRecording?.();

      // Verify message listener was removed with the same handler
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'message',
        messageHandler,
      );

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('should not accumulate message listeners across multiple sessions', () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

      // First session
      const stop1 = record({ emit, recordCrossOriginIframes: true });
      const addCallsAfterFirst = addEventListenerSpy.mock.calls.filter(
        (call) => call[0] === 'message',
      ).length;
      stop1?.();
      const removeCallsAfterFirst = removeEventListenerSpy.mock.calls.filter(
        (call) => call[0] === 'message',
      ).length;

      expect(removeCallsAfterFirst).toBe(addCallsAfterFirst);

      // Second session
      const stop2 = record({ emit, recordCrossOriginIframes: true });
      const addCallsAfterSecond = addEventListenerSpy.mock.calls.filter(
        (call) => call[0] === 'message',
      ).length;
      stop2?.();
      const removeCallsAfterSecond = removeEventListenerSpy.mock.calls.filter(
        (call) => call[0] === 'message',
      ).length;

      expect(removeCallsAfterSecond).toBe(addCallsAfterSecond);

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('should not add message listener when recordCrossOriginIframes is false', () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

      const stopRecording = record({
        emit,
        recordCrossOriginIframes: false,
      });

      // Verify no message listener was added
      const messageListenerCalls = addEventListenerSpy.mock.calls.filter(
        (call) => call[0] === 'message',
      );
      expect(messageListenerCalls.length).toBe(0);

      stopRecording?.();

      addEventListenerSpy.mockRestore();
    });

    it('should clear WeakMaps to prevent iframe memory leaks', () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      // Create an iframe element
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);

      // Track WeakMap construction calls
      const originalWeakMap = global.WeakMap;
      let weakMapConstructorCalls = 0;

      global.WeakMap = new Proxy(originalWeakMap, {
        construct(target, args) {
          weakMapConstructorCalls++;
          return new target(...args);
        },
      }) as any;

      // Start recording with cross-origin iframe support
      const stopRecording = record({
        emit,
        recordCrossOriginIframes: true,
      });

      // Capture count AFTER recording starts (IframeManager created)
      const weakMapCallsAfterRecord = weakMapConstructorCalls;

      // Stop recording - this should call destroy() which creates new WeakMaps
      stopRecording?.();

      // Verify that WeakMaps were created during cleanup
      // The IframeManager destroy() creates:
      // - 3 WeakMaps for IframeManager (crossOriginIframeMap, iframes, crossOriginIframeRootIdMap)
      // - 4 WeakMaps from CrossOriginIframeMirror.reset() calls (2 mirrors × 2 WeakMaps each)
      // - 1 WeakMap from other cleanup
      // Total: 8 new WeakMaps
      const newWeakMapsCreated =
        weakMapConstructorCalls - weakMapCallsAfterRecord;
      expect(newWeakMapsCreated).toBe(8);

      // Restore original WeakMap
      global.WeakMap = originalWeakMap;
    });
  });

  describe('IframeManager.removeIframeById cleanup', () => {
    it('should delete iframe from iframes WeakMap when removeIframeById is called', async () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      const stopRecording = record({
        emit,
        recordCrossOriginIframes: true,
      });

      // Create and append an iframe
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);

      // Wait for mutations to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Remove the iframe - this should trigger removeIframeById via wrappedMutationEmit
      document.body.removeChild(iframe);

      // Wait for removal mutation to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify that a removal mutation was emitted
      const removalEvents = events.filter(
        (e: any) =>
          e.type === 3 && // IncrementalSnapshot
          e.data?.source === 0 && // Mutation
          e.data?.removes?.length > 0,
      );
      expect(removalEvents.length).toBeGreaterThan(0);

      stopRecording?.();
    });

    it('should delete contentWindow from crossOriginIframeMap when removeIframeById is called', async () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      const stopRecording = record({
        emit,
        recordCrossOriginIframes: true,
      });

      // Create and append an iframe
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);

      // Wait for mutations to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Store a reference to verify cleanup later
      const contentWindow = iframe.contentWindow;
      expect(contentWindow).not.toBeNull();

      // Remove the iframe - this triggers removeIframeById
      document.body.removeChild(iframe);

      // Wait for removal mutation to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // The crossOriginIframeMap.delete(win) should have been called
      // We can verify this indirectly by checking the removal mutation was processed
      const removalEvents = events.filter(
        (e: any) =>
          e.type === 3 && // IncrementalSnapshot
          e.data?.source === 0 && // Mutation
          e.data?.removes?.length > 0,
      );
      expect(removalEvents.length).toBeGreaterThan(0);

      stopRecording?.();
    });

    it('should NOT call removeIframeById when iframe is moved (appears in both removes and adds)', async () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      const stopRecording = record({
        emit,
        recordCrossOriginIframes: true,
      });

      // Create a container and an iframe
      const container1 = document.createElement('div');
      const container2 = document.createElement('div');
      document.body.appendChild(container1);
      document.body.appendChild(container2);

      const iframe = document.createElement('iframe');
      container1.appendChild(iframe);

      // Wait for mutations to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      const initialEventCount = events.length;

      // Move the iframe from container1 to container2
      // This will trigger a mutation with the iframe in BOTH removes and adds
      container2.appendChild(iframe);

      // Wait for move mutation to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify that a mutation was emitted
      const mutationEvents = events.slice(initialEventCount).filter(
        (e: any) =>
          e.type === 3 && // IncrementalSnapshot
          e.data?.source === 0, // Mutation
      );
      expect(mutationEvents.length).toBeGreaterThan(0);

      // The iframe should still be tracked (not cleaned up)
      // We can verify this by removing it and seeing a removal event
      iframe.remove();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const removalEvents = events.filter(
        (e: any) =>
          e.type === 3 && // IncrementalSnapshot
          e.data?.source === 0 && // Mutation
          e.data?.removes?.length > 0,
      );
      expect(removalEvents.length).toBeGreaterThan(0);

      stopRecording?.();
    });
  });

  describe('IframeManager unit tests', () => {
    it.each([
      {
        scenario: 'with contentWindow',
        shouldAppendToDOM: true,
        shouldCallRemove: true,
        expectedMapsCleanedUp: true,
      },
      {
        scenario: 'without contentWindow',
        shouldAppendToDOM: false,
        shouldCallRemove: true,
        expectedMapsCleanedUp: true,
      },
      {
        scenario: 'when iframe is moved (not removed)',
        shouldAppendToDOM: true,
        shouldCallRemove: false,
        expectedMapsCleanedUp: false,
      },
    ])(
      'should handle cleanup correctly $scenario',
      ({ shouldAppendToDOM, shouldCallRemove, expectedMapsCleanedUp }) => {
        const mirror = createMirror();
        const mutationCb = vi.fn();
        const wrappedEmit = vi.fn();

        const mockStylesheetManager = {
          styleMirror: {
            generateId: vi.fn(() => 1),
          },
          adoptStyleSheets: vi.fn(),
        } as any;

        const iframeManager = new IframeManager({
          mirror,
          mutationCb,
          stylesheetManager: mockStylesheetManager,
          recordCrossOriginIframes: true,
          wrappedEmit,
        });

        const iframe = document.createElement('iframe');
        if (shouldAppendToDOM) {
          document.body.appendChild(iframe);
        }

        const iframeId = 123;
        mirror.add(iframe, {
          type: 2,
          tagName: 'iframe',
          attributes: {},
          childNodes: [],
          id: iframeId,
        });

        if (shouldAppendToDOM) {
          iframeManager.addIframe(iframe);

          const mockChildSn = {
            type: 0,
            childNodes: [],
            id: 456,
          } as any;

          iframeManager.attachIframe(iframe, mockChildSn);
          expect(mutationCb).toHaveBeenCalled();
        } else {
          // Manually set up attachedIframes for non-DOM case
          const manager = iframeManager as any;
          manager.attachedIframes.set(iframeId, {
            element: iframe,
            content: { type: 0, childNodes: [], id: 999 },
          });
        }

        const manager = iframeManager as any;

        // Verify initial state
        if (shouldAppendToDOM) {
          expect(manager.iframes.has(iframe)).toBe(true);
          if (iframe.contentWindow) {
            expect(manager.crossOriginIframeMap.has(iframe.contentWindow)).toBe(
              true,
            );
          }
        }
        expect(manager.attachedIframes.has(iframeId)).toBe(true);

        // Perform action
        if (shouldCallRemove) {
          expect(() => iframeManager.removeIframeById(iframeId)).not.toThrow();
        }

        // Verify final state
        if (expectedMapsCleanedUp) {
          expect(manager.iframes.has(iframe)).toBe(false);
          if (iframe.contentWindow) {
            expect(manager.crossOriginIframeMap.has(iframe.contentWindow)).toBe(
              false,
            );
          }
          expect(manager.attachedIframes.has(iframeId)).toBe(false);
        } else {
          // For moved iframes, maps should remain intact
          expect(manager.iframes.has(iframe)).toBe(true);
          if (iframe.contentWindow) {
            expect(manager.crossOriginIframeMap.has(iframe.contentWindow)).toBe(
              true,
            );
          }
        }

        // Clean up
        if (shouldAppendToDOM) {
          document.body.removeChild(iframe);
        }
        iframeManager.destroy();
      },
    );
  });

  describe('IframeManager cross-origin SecurityError handling', () => {
    function createIframeManager() {
      const mirror = createMirror();
      const iframeManager = new IframeManager({
        mirror,
        mutationCb: vi.fn(),
        stylesheetManager: {
          styleMirror: { generateId: vi.fn(() => 1) },
          adoptStyleSheets: vi.fn(),
        } as any,
        recordCrossOriginIframes: true,
        wrappedEmit: vi.fn(),
      });
      return { iframeManager, mirror };
    }

    function makeCrossOriginWindow(): Window {
      const handler: ProxyHandler<any> = {
        get(_target, prop) {
          if (prop === 'removeEventListener') {
            const err = new DOMException(
              "Failed to read a named property 'removeEventListener' from 'Window': Blocked a frame with origin",
              'SecurityError',
            );
            throw err;
          }
          return undefined;
        },
      };
      return new Proxy({}, handler) as unknown as Window;
    }

    it.each([
      { method: 'destroy' as const },
      { method: 'removeIframeById' as const },
    ])(
      '$method should not throw when contentWindow.removeEventListener throws SecurityError',
      ({ method }) => {
        const { iframeManager, mirror } = createIframeManager();
        const manager = iframeManager as any;
        const crossOriginWin = makeCrossOriginWindow();

        manager.nestedIframeListeners.set(crossOriginWin, vi.fn());

        if (method === 'destroy') {
          expect(() => iframeManager.destroy()).not.toThrow();
        } else {
          const iframe = document.createElement('iframe');
          document.body.appendChild(iframe);
          const iframeId = 42;
          mirror.add(iframe, {
            type: 2,
            tagName: 'iframe',
            attributes: {},
            childNodes: [],
            id: iframeId,
          });
          Object.defineProperty(iframe, 'contentWindow', {
            get: () => crossOriginWin,
          });
          manager.nestedIframeListeners.set(crossOriginWin, vi.fn());
          expect(() => iframeManager.removeIframeById(iframeId)).not.toThrow();
          document.body.removeChild(iframe);
        }
      },
    );

    it.each([
      { method: 'destroy' as const },
      { method: 'removeIframeById' as const },
    ])(
      '$method should still throw non-SecurityError exceptions',
      ({ method }) => {
        const { iframeManager, mirror } = createIframeManager();
        const manager = iframeManager as any;

        const badWin = new Proxy({} as any, {
          get(_target, prop) {
            if (prop === 'removeEventListener') {
              throw new TypeError('some other error');
            }
            return undefined;
          },
        }) as unknown as Window;

        manager.nestedIframeListeners.set(badWin, vi.fn());

        if (method === 'destroy') {
          expect(() => iframeManager.destroy()).toThrow(TypeError);
        } else {
          const iframe = document.createElement('iframe');
          document.body.appendChild(iframe);
          const iframeId = 43;
          mirror.add(iframe, {
            type: 2,
            tagName: 'iframe',
            attributes: {},
            childNodes: [],
            id: iframeId,
          });
          Object.defineProperty(iframe, 'contentWindow', {
            get: () => badWin,
          });
          manager.nestedIframeListeners.set(badWin, vi.fn());
          expect(() => iframeManager.removeIframeById(iframeId)).toThrow(
            TypeError,
          );
          document.body.removeChild(iframe);
        }
      },
    );

    it('attachIframe should not throw and should still invoke loadListener when contentWindow.addEventListener throws SecurityError', () => {
      const { iframeManager, mirror } = createIframeManager();
      const loadListener = vi.fn();
      iframeManager.addLoadListener(loadListener);

      const win = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'addEventListener') {
              throw new DOMException(
                "Failed to read a named property 'addEventListener' from 'Window': Blocked a frame with origin",
                'SecurityError',
              );
            }
            return undefined;
          },
        },
      ) as unknown as Window;

      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      Object.defineProperty(iframe, 'contentWindow', { get: () => win });
      mirror.add(iframe, {
        type: 2,
        tagName: 'iframe',
        attributes: {},
        childNodes: [],
        id: 101,
      });

      expect(() =>
        iframeManager.attachIframe(iframe, {
          type: 0,
          childNodes: [],
          id: 201,
        } as any),
      ).not.toThrow();
      expect(loadListener).toHaveBeenCalledWith(iframe);

      document.body.removeChild(iframe);
    });
  });

  describe('iframe observer cleanup', () => {
    it('should disconnect iframe observers when iframe is removed', async () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      const stopRecording = record({
        emit,
        recordCrossOriginIframes: true,
      });

      // Create and append an iframe
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);

      // Wait for iframe to be observed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check that mutation buffers were created for the iframe
      const buffersBeforeRemoval = mutationBuffers.length;
      expect(buffersBeforeRemoval).toBeGreaterThan(1); // main document + iframe

      // Remove the iframe
      document.body.removeChild(iframe);

      // Wait for cleanup to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify that the iframe's buffer was removed from the global array
      const buffersAfterRemoval = mutationBuffers.length;
      expect(buffersAfterRemoval).toBe(buffersBeforeRemoval - 1);

      stopRecording?.();
    });

    it('should not remove observers when iframe is moved', async () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      const stopRecording = record({
        emit,
        recordCrossOriginIframes: true,
      });

      // Create containers and iframe
      const container1 = document.createElement('div');
      const container2 = document.createElement('div');
      document.body.appendChild(container1);
      document.body.appendChild(container2);

      const iframe = document.createElement('iframe');
      container1.appendChild(iframe);

      // Wait for iframe to be observed
      await new Promise((resolve) => setTimeout(resolve, 50));

      const buffersBeforeMove = mutationBuffers.length;
      expect(buffersBeforeMove).toBeGreaterThan(1); // At least main doc + iframe

      // Move the iframe (appears in both removes and adds)
      // This should NOT trigger cleanup since the iframe ID appears in both removes and adds
      container2.appendChild(iframe);

      // Wait for mutation to be processed
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify buffers were NOT removed (should stay the same or increase if re-observed,
      // but not decrease which would indicate cleanup happened)
      const buffersAfterMove = mutationBuffers.length;
      expect(buffersAfterMove).toBeGreaterThanOrEqual(buffersBeforeMove);

      // Cleanup
      iframe.remove();
      container1.remove();
      container2.remove();
      stopRecording?.();
    });

    it('should handle multiple iframes being removed', async () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      const stopRecording = record({
        emit,
        recordCrossOriginIframes: true,
      });

      // Create multiple iframes
      const iframe1 = document.createElement('iframe');
      const iframe2 = document.createElement('iframe');
      const iframe3 = document.createElement('iframe');
      document.body.appendChild(iframe1);
      document.body.appendChild(iframe2);
      document.body.appendChild(iframe3);

      // Wait for all iframes to be observed
      await new Promise((resolve) => setTimeout(resolve, 100));

      const buffersWithIframes = mutationBuffers.length;
      expect(buffersWithIframes).toBeGreaterThanOrEqual(4); // main + 3 iframes

      // Remove iframe1
      document.body.removeChild(iframe1);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mutationBuffers.length).toBe(buffersWithIframes - 1);

      // Remove iframe2
      document.body.removeChild(iframe2);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mutationBuffers.length).toBe(buffersWithIframes - 2);

      // Remove iframe3
      document.body.removeChild(iframe3);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mutationBuffers.length).toBe(buffersWithIframes - 3);

      stopRecording?.();
    });

    it('should cleanup observers via safety net when iframe becomes inaccessible', async () => {
      const emit = (event: eventWithTime) => {
        events.push(event);
      };

      const stopRecording = record({
        emit,
        recordCrossOriginIframes: true,
      });

      // Create an iframe
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);

      // Wait for iframe to be observed
      await new Promise((resolve) => setTimeout(resolve, 50));

      const buffersBeforeRemoval = mutationBuffers.length;
      expect(buffersBeforeRemoval).toBeGreaterThan(1);

      // Remove the iframe from DOM
      document.body.removeChild(iframe);

      // Wait for cleanup to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify that the buffer was removed (either by primary cleanup or safety net)
      const buffersAfterRemoval = mutationBuffers.length;
      expect(buffersAfterRemoval).toBeLessThan(buffersBeforeRemoval);

      stopRecording?.();
    });
  });
});
