# SDK Performance Patterns Report

## Executive Summary

This report analyzes performance optimization patterns used by major analytics SDKs (Datadog RUM, Google Analytics, Mixpanel, Amplitude) to understand how PostHog can reduce its impact on Lighthouse scores and improve INP (Interaction to Next Paint).

### Key Findings

| SDK                  | requestIdleCallback | Web Worker     | Command Queue | Delayed Init       | sendBeacon |
| -------------------- | ------------------- | -------------- | ------------- | ------------------ | ---------- |
| **Datadog RUM**      | ✅ with polyfill    | ✅ for deflate | ❌            | ❌                 | ✅         |
| **Google Analytics** | ❌                  | ❌             | ❌            | ❌                 | ✅         |
| **Mixpanel**         | ❌                  | ❌             | ✅ batching   | ❌                 | ✅         |
| **Amplitude**        | ❌                  | ❌             | ✅            | ✅ (snippet)       | ✅         |
| **PostHog**          | ❌                  | ❌             | ✅            | ✅ (deferred init) | ✅         |

---

## Pattern 1: requestIdleCallback with Polyfill

### What it does

Schedules low-priority work to run when the browser is idle, avoiding interference with critical rendering and user interactions.

### Why it matters

- Better than `setTimeout(0)` because the browser understands these are low-priority tasks
- Browser can delay these tasks if there's pending user interaction
- Directly improves INP by not competing with interaction handlers

### Datadog RUM Implementation

```javascript
// From Datadog RUM SDK
function requestIdleCallbackShim(callback, options) {
    if (window.requestIdleCallback && window.cancelIdleCallback) {
        const handle = window.requestIdleCallback(callback, options)
        return () => window.cancelIdleCallback(handle)
    }

    // Polyfill for browsers without requestIdleCallback (Safari)
    const start = performance.now()
    const timeoutId = setTimeout(() => {
        callback({
            didTimeout: false,
            timeRemaining: () => Math.max(0, 50 - (performance.now() - start)),
        })
    }, 0)

    return () => clearTimeout(timeoutId)
}
```

### How PostHog could use it

```javascript
// In scheduler.ts - enhanced version
const IDLE_TIMEOUT = 50; // ms

function scheduleIdleWork(callback: () => void, options?: { timeout?: number }): () => void {
    if (typeof window !== 'undefined' && window.requestIdleCallback) {
        const handle = window.requestIdleCallback(
            (deadline) => {
                // Run callback, respecting the idle deadline
                callback();
            },
            options
        );
        return () => window.cancelIdleCallback(handle);
    }

    // Polyfill
    const start = performance.now();
    const timeoutId = setTimeout(() => {
        callback();
    }, 0);

    return () => clearTimeout(timeoutId);
}

// Usage in extension initialization
function initExtensions(extensions: Extension[]) {
    scheduleIdleWork(() => {
        extensions.forEach(ext => ext.init());
    }, { timeout: 2000 }); // Must run within 2 seconds even if never idle
}
```

### Browser Support

- Chrome, Edge, Firefox: Full support
- Safari: No support (polyfill falls back to setTimeout)

---

## Pattern 2: Web Worker for Heavy Processing

### What it does

Moves CPU-intensive work (compression, serialization) to a background thread, completely off the main thread.

### Why it matters

- Main thread stays free for user interactions
- Eliminates long tasks from compression/serialization
- Critical for session recording which processes large amounts of data

### Datadog RUM Implementation

```javascript
// Datadog creates an inline Worker from a Blob containing deflate code
function createDeflateWorker(config) {
    const workerCode = `
        // Inline deflate/compression implementation
        (function() {
            const deflateState = new Map();

            self.addEventListener('message', (event) => {
                const { action, streamId, data, id } = event.data;

                switch (action) {
                    case 'init':
                        self.postMessage({ type: 'initialized', version: '1.0.0' });
                        break;

                    case 'write':
                        const compressed = deflate(data);
                        self.postMessage({
                            type: 'wrote',
                            id: id,
                            streamId: streamId,
                            result: compressed,
                            additionalBytesCount: data.length
                        });
                        break;

                    case 'reset':
                        deflateState.delete(streamId);
                        break;
                }
            });

            function deflate(data) {
                // ... deflate implementation
            }
        })();
    `

    const blob = new Blob([workerCode], { type: 'application/javascript' })
    const workerUrl = URL.createObjectURL(blob)
    return new Worker(workerUrl)
}

// Usage
const worker = createDeflateWorker(config)

worker.postMessage({ action: 'init' })

worker.postMessage({
    action: 'write',
    id: requestId,
    streamId: sessionId,
    data: jsonPayload,
})

worker.addEventListener('message', (event) => {
    if (event.data.type === 'wrote') {
        sendToServer(event.data.result)
    }
})
```

### How PostHog could use it

```javascript
// worker-compression.ts
const COMPRESSION_WORKER_CODE = `
    self.addEventListener('message', async (event) => {
        const { action, id, data } = event.data;

        if (action === 'compress') {
            try {
                // Use CompressionStream if available
                if (typeof CompressionStream !== 'undefined') {
                    const stream = new CompressionStream('gzip');
                    const writer = stream.writable.getWriter();
                    const encoder = new TextEncoder();
                    writer.write(encoder.encode(data));
                    writer.close();

                    const reader = stream.readable.getReader();
                    const chunks = [];
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(value);
                    }

                    const compressed = new Uint8Array(
                        chunks.reduce((acc, chunk) => acc + chunk.length, 0)
                    );
                    let offset = 0;
                    for (const chunk of chunks) {
                        compressed.set(chunk, offset);
                        offset += chunk.length;
                    }

                    self.postMessage({ id, compressed, success: true });
                } else {
                    // Fallback: return original data
                    self.postMessage({ id, data, success: true, uncompressed: true });
                }
            } catch (error) {
                self.postMessage({ id, error: error.message, success: false });
            }
        }

        if (action === 'serialize') {
            try {
                const json = JSON.stringify(data);
                self.postMessage({ id, json, success: true });
            } catch (error) {
                self.postMessage({ id, error: error.message, success: false });
            }
        }
    });
`;

class CompressionWorkerManager {
    private worker: Worker | null = null;
    private pendingRequests = new Map<string, { resolve: Function; reject: Function }>();
    private requestId = 0;

    init() {
        if (typeof Worker === 'undefined') return;

        try {
            const blob = new Blob([COMPRESSION_WORKER_CODE], { type: 'application/javascript' });
            this.worker = new Worker(URL.createObjectURL(blob));

            this.worker.addEventListener('message', (event) => {
                const { id, success, ...result } = event.data;
                const pending = this.pendingRequests.get(id);
                if (pending) {
                    this.pendingRequests.delete(id);
                    if (success) {
                        pending.resolve(result);
                    } else {
                        pending.reject(new Error(result.error));
                    }
                }
            });
        } catch (e) {
            // Worker creation failed, will fallback to main thread
            console.warn('Failed to create compression worker:', e);
        }
    }

    async compress(data: string): Promise<Uint8Array | string> {
        if (!this.worker) {
            // Fallback to main thread
            return data;
        }

        const id = String(++this.requestId);
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.worker!.postMessage({ action: 'compress', id, data });
        });
    }
}
```

---

## Pattern 3: Command Queue / Event Buffering

### What it does

Buffers method calls before SDK is fully initialized, then replays them once ready.

### Why it matters

- Allows SDK to load asynchronously without losing events
- Page can continue rendering while SDK initializes
- Events captured immediately, processed later

### Amplitude Snippet Implementation

```javascript
// Amplitude's lightweight snippet that buffers calls
;(function () {
    var amplitude = window.amplitude || { _q: [] }

    // Proxy that buffers all method calls
    var methods = ['init', 'track', 'identify', 'setUserId', 'setUserProperties']

    methods.forEach(function (method) {
        amplitude[method] = function () {
            amplitude._q.push({
                method: method,
                args: Array.prototype.slice.call(arguments),
            })
        }
    })

    window.amplitude = amplitude

    // Load full SDK asynchronously
    var script = document.createElement('script')
    script.src = 'https://cdn.amplitude.com/sdk.js'
    script.async = true
    script.onload = function () {
        // Full SDK replays queued commands
        amplitude._q.forEach(function (call) {
            amplitude[call.method].apply(amplitude, call.args)
        })
        amplitude._q = []
    }
    document.head.appendChild(script)
})()
```

### Mixpanel's Event Queue

```javascript
// From Mixpanel SDK - event queue with receiver pattern
class EventQueue {
    constructor() {
        this.queue = []
        this.receiver = null
    }

    logEvent(event) {
        if (this.receiver) {
            // SDK ready, send immediately
            this.receiver(event)
        } else if (this.queue.length < 512) {
            // Buffer until ready (with limit to prevent memory issues)
            this.queue.push(event)
        }
    }

    setEventReceiver(receiver) {
        this.receiver = receiver

        // Replay queued events
        if (this.queue.length > 0) {
            this.queue.forEach((event) => receiver(event))
            this.queue = []
        }
    }
}
```

### PostHog's Current Implementation

PostHog already has this pattern - events are queued until initialization completes. No changes needed.

---

## Pattern 4: Delayed Initialization

### What it does

Defers SDK initialization to allow the page to render first.

### Why it matters

- Reduces TBT (Total Blocking Time) during initial load
- Page becomes interactive faster
- Lighthouse scores improve

### Amplitude Snippet Implementation

```javascript
// From Amplitude SDK snippet
setTimeout(function () {
    var amplitude = window.amplitude
    if (amplitude && !amplitude._configuration?.apiKey) {
        // Initialize after 500ms delay
        amplitude.init('API_KEY', {
            serverZone: 'US',
        })
    }
}, 500)
```

### How PostHog could enhance this

```javascript
// Enhanced deferred initialization
class PostHogDeferredInit {
    private initPromise: Promise<void> | null = null;
    private config: PostHogConfig | null = null;

    init(apiKey: string, config: Partial<PostHogConfig> = {}) {
        this.config = { apiKey, ...config };

        // If page is still loading, defer initialization
        if (document.readyState !== 'complete') {
            this.initPromise = new Promise((resolve) => {
                window.addEventListener('load', () => {
                    // Additional delay after load event
                    this.scheduleInit(resolve);
                });
            });
        } else {
            this.initPromise = new Promise((resolve) => {
                this.scheduleInit(resolve);
            });
        }

        return this.initPromise;
    }

    private scheduleInit(resolve: () => void) {
        // Use requestIdleCallback if available
        if (window.requestIdleCallback) {
            window.requestIdleCallback(() => {
                this.doInit();
                resolve();
            }, { timeout: 2000 });
        } else {
            // Fallback: delay by 100ms to let other critical work complete
            setTimeout(() => {
                this.doInit();
                resolve();
            }, 100);
        }
    }

    private doInit() {
        // Actual initialization logic
        if (this.config) {
            // ... initialize SDK
        }
    }
}
```

---

## Pattern 5: sendBeacon for Page Unload

### What it does

Uses `navigator.sendBeacon()` to send data when the page is unloading, without blocking navigation.

### Why it matters

- Guaranteed delivery even during page unload
- Doesn't block navigation (unlike synchronous XHR)
- Better user experience when navigating away

### Datadog RUM Implementation

```javascript
// From Datadog RUM
function sendWithBeacon(url, data, maxSize) {
    if (navigator.sendBeacon && data.bytesCount < maxSize) {
        try {
            const payload = buildPayload('beacon', data)
            if (navigator.sendBeacon(url, data.data)) {
                return true // Successfully queued
            }
        } catch (e) {
            // sendBeacon failed, fall through to XHR
        }
    }
    return false
}

// Page lifecycle handling
function setupPageLifecycleHandlers(flush) {
    const events = ['visibilitychange', 'pagehide', 'freeze']

    events.forEach((eventType) => {
        window.addEventListener(
            eventType,
            (event) => {
                if (eventType === 'visibilitychange' && document.visibilityState === 'hidden') {
                    flush({ transport: 'beacon' })
                } else if (eventType === 'pagehide' || eventType === 'freeze') {
                    flush({ transport: 'beacon' })
                }
            },
            { capture: true }
        )
    })
}
```

### Mixpanel Implementation

```javascript
// From Mixpanel SDK
RequestBatcher.prototype.flush = function (options) {
    options = options || {}

    var requestOptions = {
        method: 'POST',
        verbose: true,
        timeout_ms: this.libConfig['batch_request_timeout_ms'],
    }

    // Use sendBeacon for page unload
    if (options.unloading) {
        requestOptions.transport = 'sendBeacon'
    }

    return this.sendRequestPromise(data, requestOptions)
}

// Page leave tracking with beacon
Autocapture.prototype._trackPageLeave = function () {
    var props = {
        $current_url: window.location.href,
        $time_on_page: this.getTimeOnPage(),
    }

    // Send with beacon transport to ensure event is sent before unload
    this.mp.track('$mp_page_leave', props, { transport: 'sendBeacon' })
}
```

### PostHog's Current Implementation

PostHog already uses sendBeacon - this is well implemented.

---

## Pattern 6: Batched Throttle for High-Frequency Events

### What it does

Groups multiple events together and processes them in batches at a throttled rate.

### Why it matters

- Reduces network requests
- Prevents overwhelming the main thread with rapid event processing
- Important for session recording which generates many events

### Mixpanel Implementation

```javascript
// From Mixpanel SDK
var batchedThrottle = function (fn, waitMs) {
    var timeoutPromise = null
    var throttledItems = []

    return function (item) {
        var self = this
        throttledItems.push(item)

        if (!timeoutPromise) {
            timeoutPromise = new Promise(function (resolve) {
                setTimeout(function () {
                    // Process all accumulated items at once
                    var returnValue = fn.apply(self, [throttledItems])
                    timeoutPromise = null
                    throttledItems = []
                    resolve(returnValue)
                }, waitMs)
            })
        }

        return timeoutPromise
    }
}

// Usage
var throttledSend = batchedThrottle(function (events) {
    return sendBatch(events)
}, 1000) // Batch events every 1 second

// Each call adds to the batch
throttledSend(event1)
throttledSend(event2)
throttledSend(event3)
// After 1 second, all 3 events are sent together
```

---

## Recommendations for PostHog

### High Priority (Low Effort, High Impact)

1. **Add requestIdleCallback to scheduler**
    - Replace `setTimeout(0)` with `requestIdleCallback` where appropriate
    - Add polyfill for Safari
    - Use for: extension init, non-critical queue processing

2. **Use requestIdleCallback for extension initialization**
    - Current: Extensions init immediately or via setTimeout
    - Proposed: Use requestIdleCallback with timeout fallback

### Medium Priority (Medium Effort, High Impact)

3. **Web Worker for session recording compression**
    - Move JSON serialization and compression off main thread
    - Use inline Blob worker to avoid extra network request
    - Critical for pages with heavy session recording

4. **Tiered initialization**
    - Core event capture: Initialize immediately
    - Session recording: Initialize after `load` event
    - Feature flags: Initialize via requestIdleCallback
    - Surveys/toolbar: Lazy load on demand

### Lower Priority (Higher Effort)

5. **Smaller bootstrap bundle**
    - Split SDK into core + extensions
    - Inline tiny bootstrap, lazy load rest
    - Dynamic imports for features

### What PostHog Already Does Well

- Event batching ✅
- sendBeacon for page unload ✅
- Deferred init option (`__preview_deferred_init_extensions`) ✅
- setTimeout yielding (via scheduler) ✅
- Request queue with retry ✅

---

## Appendix: INP Benchmark Results

Local testing comparing npm version (no scheduler) vs branch with scheduler yielding:

| Test                  | npm (no scheduler) | local (scheduler) | Improvement |
| --------------------- | ------------------ | ----------------- | ----------- |
| Simple page - Max INP | 56ms               | 48ms              | **-14%**    |
| Media page - Max INP  | 64ms               | 48ms              | **-25%**    |
| Simple page - P95 INP | 32ms               | 24ms              | **-25%**    |

The scheduler reduces worst-case INP by 14-25%, confirming the approach works but showing there's room for further improvement with requestIdleCallback.

---

## References

- [Datadog RUM SDK](https://github.com/DataDog/browser-sdk)
- [Mixpanel JS SDK](https://github.com/mixpanel/mixpanel-js)
- [Amplitude TypeScript SDK](https://github.com/amplitude/Amplitude-TypeScript)
- [Google Analytics (gtag.js)](https://developers.google.com/analytics/devguides/collection/gtagjs)
- [MDN: requestIdleCallback](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestIdleCallback)
- [web.dev: Optimize Interaction to Next Paint](https://web.dev/inp/)
