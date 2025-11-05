I'll analyze the codebase to understand how token bucket rate limiting is applied to different exception types in the error tracking feature. Let me start by exploring the repository structure.
Now let me dive deeper into the rate limiting and error tracking implementation to understand how token buckets work with different exception types.
Perfect! I have comprehensive information about the token bucket rate limiting and exception type bucketing. Let me present my research findings:

````markdown
# Research Findings

## Codebase Analysis

The PostHog JavaScript SDK implements a sophisticated **bucketed token bucket rate limiter** specifically designed for exception tracking. The system is located across several key files:

- **Core Implementation**: `/packages/core/src/utils/bucketed-rate-limiter.ts` - Generic BucketedRateLimiter class that manages per-key token buckets
- **Exception Integration**: `/packages/browser/src/extensions/exception-autocapture/index.ts` - ExceptionObserver that instantiates and uses the rate limiter
- **Exception Filtering**: `/packages/browser/src/posthog-exceptions.ts` - Post-capture filtering by suppression rules, extension origin, and SDK origin
- **Error Classification**: `/packages/core/src/error-tracking/` - Multiple coercers that extract and classify exception types (Error, TypeError, PromiseRejectionEvent, DOMException, etc.)
- **Event Queuing**: `/packages/browser/src/request-queue.ts` - Batches exceptions separately via `_batchKey: 'exceptionEvent'`

## Key Areas of Focus

### 1. Token Bucket Algorithm (`/packages/core/src/utils/bucketed-rate-limiter.ts`)

- **Generic bucketed design**: Each exception type gets its own independent bucket with separate token allocation
- **Token consumption logic**: `consumeRateLimit(key: T)` returns `true` (rate limited) or `false` (allowed)
- **Refill mechanism**: Tokens refill only on complete intervals (10-second default), not partial intervals
- **Callback support**: Optional `_onBucketRateLimited` callback fires when bucket exhausted

### 2. Exception Type Extraction (`/packages/browser/src/extensions/exception-autocapture/index.ts`, lines 142-154)

- Exception type is extracted from: `errorProperties?.$exception_list?.[0]?.type ?? 'Exception'`
- Used as the **bucket key** for per-type rate limiting
- Examples of types: `'Error'`, `'TypeError'`, `'ReferenceError'`, `'PromiseRejectionEvent'`, `'DOMException'`

### 3. Default Rate Limit Configuration (lines 29-34)

- **Bucket Size**: 10 tokens (allows 10 exceptions before limiting)
- **Refill Rate**: 1 token per interval
- **Refill Interval**: 10,000 ms (10 seconds)
- **Result**: 10 exceptions of each type allowed initially, then 1 per 10 seconds per type thereafter
- **Configurable** via `error_tracking.__exceptionRateLimiterBucketSize` and `__exceptionRateLimiterRefillRate`

### 4. Exception Type Classification

- **Coercers** in `/packages/core/src/error-tracking/coercers/` classify different error sources:
    - `error-coercer.ts` → native Error objects
    - `promise-rejection-event.ts` → unhandled promise rejections
    - `error-event-coercer.ts` → ErrorEvent objects
    - `dom-exception-coercer.ts` → DOM exceptions
    - Others for string/primitive/object errors
- Each coercer assigns a `type` field that becomes the bucket key

### 5. Filtering Layers

- **Client-side rate limiting** (first layer): Per-exception-type token bucket
- **Suppression rules** (second layer): Server-defined rules matching `$exception_types` and `$exception_values`
- **Extension exception filter** (third layer): Filters `chrome-extension://` URLs unless enabled
- **SDK self-exception filter** (fourth layer): Filters exceptions from PostHog SDK itself unless enabled

## Implementation Context

### How Different Exception Types Get Bucketed Differently

1. **Type Extraction**: When an exception is captured, `ErrorPropertiesBuilder` parses the stack trace and identifies the exception type using browser/platform-specific parsers (Chrome, Safari, Firefox, Node, React Native)

2. **Bucket Assignment**: The exception type (e.g., `'TypeError'`, `'ReferenceError'`) becomes the key in the `BucketedRateLimiter`

3. **Independent Rate Limiting**: Each exception type has its own token bucket:

    - `'TypeError'` bucket: starts with 10 tokens
    - `'ReferenceError'` bucket: starts with 10 tokens
    - `'DOMException'` bucket: starts with 10 tokens
    - etc.

4. **Token Consumption**: When an exception of a given type is captured, `consumeRateLimit(exceptionType)` is called. If the bucket for that type is exhausted (0 tokens), the exception is dropped

5. **Refill Timing**: Each bucket refills independently based on its `lastAccess` time. A ReferenceError exception type won't affect the refill timing of TypeError exceptions

### Two Rate Limiting Systems

The SDK has **two separate rate limiting mechanisms**:

1. **Exception-Specific Rate Limiting** (`BucketedRateLimiter` in ExceptionObserver):

    - Per-exception-type bucketing
    - Configured via `error_tracking.__exceptionRateLimiter*` config
    - Runs **first** in the exception capture pipeline

2. **Global Event Rate Limiting** (`RateLimiter` in request.ts):
    - Token bucket for ALL events (not exception-specific)
    - Default: 10 events/sec, burst limit 100
    - Uses persistent storage to sync client-side limits
    - Detects and respects server-side quota headers

### Exception Flow to Rate Limiting

1. Global handlers catch exception (window.onerror, window.onunhandledrejection, console.error)
2. ErrorPropertiesBuilder parses and extracts exception type
3. **ExceptionObserver.captureException() checks token bucket** (first filter)
4. If rate limited, exception is dropped with log message
5. If allowed, goes to PostHogExceptions.sendExceptionEvent() for additional filtering
6. If passes filters, sent to event queue with `_batchKey: 'exceptionEvent'` (separate batch)
7. Queued and batched separately with 3-second flush interval
8. Sent to `/e/` endpoint

### Configuration & Customization

Exception rate limiting is fully configurable:

```typescript
new PostHog({
    error_tracking: {
        __exceptionRateLimiterBucketSize: 10, // Max exceptions per type before limiting
        __exceptionRateLimiterRefillRate: 1, // Tokens added per interval
        // refillInterval is hardcoded to 10000ms
    },
})
```
````

## Clarifying Questions

None needed — the codebase provides clear, complete implementation of exception-type-aware rate limiting with well-documented code paths and configuration options.

```

```
