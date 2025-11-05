# Token Bucket Rate Limiting for Exception Types in PostHog SDK

## Executive Summary

The PostHog JavaScript SDK implements a **per-exception-type token bucket rate limiter** to prevent exception tracking from overwhelming the system. Each exception type (TypeError, ReferenceError, etc.) maintains its own independent token bucket, ensuring that a flood of one error type doesn't prevent other exception types from being captured.

**Key Insight:** Different exception types are bucketed independently, so exhausting the rate limit for `TypeError` doesn't affect the ability to capture `ReferenceError` exceptions.

---

## How Token Bucket Rate Limiting Works

### The Token Bucket Algorithm

A token bucket is a rate limiting algorithm that works like this:

1. **Bucket Creation**: Each bucket starts with a fixed number of tokens (default: 10)
2. **Token Consumption**: Each exception captured consumes 1 token from its type-specific bucket
3. **Token Refill**: Tokens refill at a fixed rate over time (default: 1 token per 10 seconds)
4. **Rate Limiting**: When a bucket is empty (0 tokens), exceptions of that type are dropped until tokens refill

### Core Implementation

**File:** `/packages/core/src/utils/bucketed-rate-limiter.ts`

The `BucketedRateLimiter<T>` class implements a generic bucketed token bucket:

```typescript
export class BucketedRateLimiter<T extends string | number> {
    private _bucketSize: number // Max tokens per bucket (default: 10)
    private _refillRate: number // Tokens added per interval (default: 1)
    private _refillInterval: number // Refill interval in ms (default: 10000)
    private _buckets: Record<string, Bucket> = {}
}
```

**Key Method:** `consumeRateLimit(key: T): boolean`

```typescript
public consumeRateLimit(key: T): boolean {
    const now = Date.now()
    const keyStr = String(key)

    let bucket = this._buckets[keyStr]

    // Create new bucket if it doesn't exist
    if (!bucket) {
      bucket = { tokens: this._bucketSize, lastAccess: now }
      this._buckets[keyStr] = bucket
    } else {
      // Refill tokens based on elapsed time
      this._applyRefill(bucket, now)
    }

    // Check if rate limited
    if (bucket.tokens === 0) {
      return true  // Rate limited!
    }

    // Consume a token
    bucket.tokens--

    return bucket.tokens === 0  // Rate limited if no tokens left
}
```

### Token Refill Logic

**Method:** `_applyRefill(bucket: Bucket, now: number): void`

```typescript
private _applyRefill(bucket: Bucket, now: number): void {
    const elapsedMs = now - bucket.lastAccess
    const refillIntervals = Math.floor(elapsedMs / this._refillInterval)

    if (refillIntervals > 0) {
      const tokensToAdd = refillIntervals * this._refillRate
      bucket.tokens = Math.min(bucket.tokens + tokensToAdd, this._bucketSize)
      bucket.lastAccess = bucket.lastAccess + refillIntervals * this._refillInterval
    }
}
```

**Important:** Tokens only refill on **complete intervals**. If the refill interval is 10 seconds and only 5 seconds have passed, no tokens are added yet.

---

## How Exception Types Are Bucketed

### Exception Type Extraction

**File:** `/packages/browser/src/extensions/exception-autocapture/index.ts` (lines 142-154)

```typescript
captureException(errorProperties: ErrorTracking.ErrorProperties) {
    // Extract exception type from the first exception in the list
    const exceptionType = errorProperties?.$exception_list?.[0]?.type ?? 'Exception'

    // Check rate limit for THIS specific exception type
    const isRateLimited = this._rateLimiter.consumeRateLimit(exceptionType)

    if (isRateLimited) {
        logger.info('Skipping exception capture because of client rate limiting.', {
            exception: exceptionType,
        })
        return
    }

    // Not rate limited - proceed with capturing
    this._instance.exceptions.sendExceptionEvent(errorProperties)
}
```

### Exception Type Classification

**File:** `/packages/core/src/error-tracking/coercers/`

The SDK uses multiple "coercers" to extract exception types from different sources:

#### 1. Error Coercer (Native JavaScript Errors)

**File:** `error-coercer.ts`

```typescript
export class ErrorCoercer implements ErrorTrackingCoercer<Error> {
    match(err: unknown): err is Error {
        return isPlainError(err)
    }

    coerce(err: Error, ctx: CoercingContext): ExceptionLike {
        return {
            type: this.getType(err), // Uses err.name or err.constructor.name
            value: this.getMessage(err, ctx),
            stack: this.getStack(err),
            cause: err.cause ? ctx.next(err.cause) : undefined,
            synthetic: false,
        }
    }

    private getType(err: Error): string {
        return err.name || err.constructor.name // e.g., "TypeError", "ReferenceError"
    }
}
```

**Exception Types Captured:**

- `Error` - Generic JavaScript errors
- `TypeError` - Type-related errors
- `ReferenceError` - Reference errors
- `SyntaxError` - Syntax errors
- `RangeError` - Range errors
- `URIError` - URI handling errors
- Custom error types that extend Error

#### 2. Promise Rejection Event Coercer

**File:** `promise-rejection-event.ts`

```typescript
export class PromiseRejectionEventCoercer implements ErrorTrackingCoercer<PromiseRejectionEvent> {
    coerce(err: PromiseRejectionEvent, ctx: CoercingContext): ExceptionLike | undefined {
        const reason = this.getUnhandledRejectionReason(err)
        if (isPrimitive(reason)) {
            return {
                type: 'UnhandledRejection', // Fixed type for primitive promise rejections
                value: `Non-Error promise rejection captured with value: ${String(reason)}`,
                stack: ctx.syntheticException?.stack,
                synthetic: true,
            }
        } else {
            return ctx.apply(reason) // Delegate to other coercers if reason is an Error
        }
    }
}
```

**Exception Types Captured:**

- `UnhandledRejection` - Promise rejections with primitive values
- Or the actual error type if the rejection reason is an Error object

#### 3. Other Coercers

| Coercer                 | Exception Types                            |
| ----------------------- | ------------------------------------------ |
| `dom-exception-coercer` | `DOMException` (e.g., QuotaExceededError)  |
| `error-event-coercer`   | Extracts type from ErrorEvent.error        |
| `string-coercer`        | `'Exception'` (fallback for string errors) |
| `primitive-coercer`     | `'Exception'` (fallback for primitives)    |
| `object-coercer`        | `'Exception'` (fallback for plain objects) |

---

## Independent Bucket Behavior

### Example Scenario

Let's walk through a concrete example:

**Configuration:**

- Bucket size: 10 tokens
- Refill rate: 1 token per 10 seconds

**Timeline:**

```
Time 0s:
  TypeError bucket:       [••••••••••] 10 tokens
  ReferenceError bucket:  [••••••••••] 10 tokens

Time 1s: 10 TypeErrors occur
  TypeError bucket:       [          ] 0 tokens (exhausted)
  ReferenceError bucket:  [••••••••••] 10 tokens (unchanged)

Time 2s: Another TypeError occurs
  Result: RATE LIMITED ❌ (dropped)
  TypeError bucket:       [          ] 0 tokens

Time 2s: A ReferenceError occurs
  Result: ALLOWED ✅ (captured)
  ReferenceError bucket:  [•••••••••·] 9 tokens

Time 11s: (10 seconds elapsed since TypeError exhaustion)
  TypeError bucket:       [•         ] 1 token (refilled)
  ReferenceError bucket:  [••••••••••] 10 tokens (refilled to max)

Time 12s: Another TypeError occurs
  Result: ALLOWED ✅ (captured)
  TypeError bucket:       [          ] 0 tokens

Time 21s: (10 more seconds elapsed)
  TypeError bucket:       [•         ] 1 token (refilled again)
```

### Key Observations

1. **Complete Independence**: `TypeError` exhaustion has zero impact on `ReferenceError` bucket
2. **Per-Type Quotas**: Each exception type can burst up to 10 events, then sustains at 1 per 10 seconds
3. **Interval-Based Refill**: Tokens refill only on complete 10-second intervals, not continuously
4. **Automatic Bucket Creation**: Buckets are created on-demand when a new exception type is encountered

---

## Rate Limiting Configuration

### Default Configuration

**File:** `/packages/browser/src/extensions/exception-autocapture/index.ts` (lines 26-34)

```typescript
this._rateLimiter = new BucketedRateLimiter({
    refillRate: this._instance.config.error_tracking.__exceptionRateLimiterRefillRate ?? 1,
    bucketSize: this._instance.config.error_tracking.__exceptionRateLimiterBucketSize ?? 10,
    refillInterval: 10000, // 10 seconds (hardcoded)
    _logger: logger,
})
```

**Default Behavior:**

- **Bucket Size:** 10 tokens per exception type
- **Refill Rate:** 1 token per interval
- **Refill Interval:** 10,000ms (10 seconds) - hardcoded, not configurable
- **Result:** Burst of 10 exceptions, then 1 exception per 10 seconds sustained

### Custom Configuration

You can customize the bucket size and refill rate:

```typescript
const posthog = new PostHog({
    error_tracking: {
        __exceptionRateLimiterBucketSize: 20, // Allow 20 exceptions before limiting
        __exceptionRateLimiterRefillRate: 2, // Add 2 tokens per 10-second interval
    },
})
```

**Note:** The refill interval (10 seconds) is hardcoded and cannot be customized.

---

## Complete Exception Capture Flow

Here's the full pipeline from exception to event:

```
1. Exception occurs in application
   │
   ↓
2. Global exception handlers catch it
   │  • window.onerror (unhandled errors)
   │  • window.onunhandledrejection (promise rejections)
   │  • console.error wrapper (console errors)
   │
   ↓
3. Error coercers classify and extract exception type
   │  • ErrorCoercer → "TypeError", "ReferenceError", etc.
   │  • PromiseRejectionEventCoercer → "UnhandledRejection"
   │  • DOMExceptionCoercer → "DOMException"
   │  • Fallback coercers → "Exception"
   │
   ↓
4. ExceptionObserver.captureException()
   │
   ├─► BucketedRateLimiter.consumeRateLimit(exceptionType)
   │   │
   │   ├─ Bucket empty? → YES ❌ DROP (rate limited)
   │   │                           └─ Log: "Skipping exception capture..."
   │   │
   │   └─ Tokens available? → YES ✅ CONTINUE
   │                               └─ Consume 1 token
   │
   ↓
5. PostHogExceptions.sendExceptionEvent()
   │
   ├─► Suppression rules check (server-defined filters)
   ├─► Extension exception filter (chrome-extension:// URLs)
   ├─► SDK self-exception filter (PostHog SDK internal errors)
   │
   ↓
6. Add to event queue with _batchKey: 'exceptionEvent'
   │  (Exceptions are batched separately from other events)
   │
   ↓
7. Batch flush (every 3 seconds)
   │
   ↓
8. Global event rate limiter check
   │  (Separate rate limiter: 10 events/sec, burst 100)
   │
   ↓
9. Send to /e/ endpoint (PostHog ingestion)
```

---

## Two Independent Rate Limiting Systems

The SDK implements **two separate, independent** rate limiting mechanisms:

### 1. Exception-Specific Bucketed Rate Limiter (First Line of Defense)

- **Class:** `BucketedRateLimiter` in `ExceptionObserver`
- **Scope:** Per-exception-type (independent buckets)
- **Location:** Before event queuing (step 4 in flow above)
- **Purpose:** Prevent flooding from specific exception types
- **Configuration:** `error_tracking.__exceptionRateLimiter*` options
- **Default:** 10 exceptions per type, then 1 per 10 seconds

### 2. Global Event Rate Limiter (Second Line of Defense)

- **Class:** `RateLimiter` in `request.ts`
- **Scope:** All events (not exception-specific)
- **Location:** Before network transmission (step 8 in flow above)
- **Purpose:** Prevent overwhelming the server with all event types
- **Configuration:** Default 10 events/sec, burst limit 100
- **Behavior:** Uses persistent storage, respects server quota headers

**Key Difference:** Exception-specific rate limiting happens **before** queueing, while global rate limiting happens **before** transmission. An exception can pass the first check but still be rate limited by the second.

---

## Why Per-Exception-Type Bucketing?

### Problem Without Per-Type Bucketing

Imagine a single global bucket for all exceptions:

```
Scenario: A bug causes 100 TypeErrors per second
Result: All 10 tokens consumed by TypeErrors
Impact: Important ReferenceErrors are now also rate limited
        Critical exceptions go unreported!
```

### Solution: Independent Buckets

With per-type bucketing:

```
Scenario: A bug causes 100 TypeErrors per second
Result: TypeError bucket exhausted (drops excess TypeErrors)
Impact: ReferenceError bucket unaffected
        Critical exceptions still captured! ✅
```

### Benefits

1. **Fault Isolation**: One exception type's flood doesn't affect others
2. **Better Visibility**: You still see a sample of each error type
3. **Proportional Capture**: Common errors and rare errors both get fair representation
4. **Debugging Efficiency**: Multiple distinct issues visible even during exception storms

---

## Implementation Details

### Bucket State Structure

```typescript
type Bucket = {
    tokens: number // Current available tokens (0 to bucketSize)
    lastAccess: number // Timestamp of last access (for refill calculation)
}
```

### Rate Limit Callback

The rate limiter supports an optional callback when a bucket is exhausted:

```typescript
_onBucketRateLimited?: (key: T) => void
```

Currently used for logging when an exception type is rate limited:

```typescript
logger.info('Skipping exception capture because of client rate limiting.', {
    exception: exceptionType,
})
```

### Bucket Lifecycle

1. **Creation**: Lazy creation when first exception of that type occurs
2. **Operation**: Tokens consumed on each exception, refilled over time
3. **Cleanup**: Buckets persist in memory for the lifetime of the `ExceptionObserver`
4. **Reset**: `stop()` method clears all buckets

### Thread Safety

**Note:** This implementation is designed for single-threaded JavaScript environments. The rate limiter uses synchronous operations and doesn't require locking mechanisms.

---

## Testing and Verification

### Verifying Rate Limiting Behavior

You can verify rate limiting in your browser console:

```javascript
// Generate 15 TypeErrors quickly
for (let i = 0; i < 15; i++) {
    try {
        null.foo() // Causes TypeError
    } catch (e) {
        // Caught but PostHog should still capture it
    }
}

// Check browser console for:
// "[ExceptionAutocapture] Skipping exception capture because of client rate limiting. {exception: 'TypeError'}"

// Now try a different exception type
try {
    nonExistentVariable // Causes ReferenceError
} catch (e) {}

// This should still be captured because ReferenceError has its own bucket!
```

### Monitoring Rate Limiting

To monitor which exception types are being rate limited, watch for log messages:

```
[ExceptionAutocapture] Skipping exception capture because of client rate limiting. {exception: 'TypeError'}
```

---

## Answers to Common Questions

### Q1: What happens when a bucket is exhausted?

The exception is dropped immediately (not queued or delayed). A log message is generated indicating which exception type was rate limited.

### Q2: Do rate limits reset when the page reloads?

Yes. All buckets are stored in memory and are reset when the `ExceptionObserver` is recreated on page load.

### Q3: Can different pages or tabs share rate limits?

No. Each page/tab has its own independent `ExceptionObserver` with separate buckets.

### Q4: What if an exception type name is very long or unusual?

The bucket key is simply the string representation of the exception type. There's no practical limit on key length, and any string is valid.

### Q5: Can I disable exception rate limiting?

Not directly, but you can set `__exceptionRateLimiterBucketSize` to a very high value (max 100 per the code's clamping logic).

### Q6: How do I know if exceptions are being rate limited in production?

Currently, rate limiting is only logged to the browser console (not sent as an event). You would need to monitor browser console logs or implement custom telemetry.

### Q7: Does the rate limiter account for exception severity?

No. All exceptions of the same type are treated equally regardless of their content, stack trace, or context.

---

## File Reference Guide

| File Path                                                               | Purpose                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------ |
| `/packages/core/src/utils/bucketed-rate-limiter.ts`                     | Generic bucketed token bucket implementation     |
| `/packages/browser/src/extensions/exception-autocapture/index.ts`       | Exception observer with rate limiter integration |
| `/packages/browser/src/posthog-exceptions.ts`                           | Post-rate-limit exception filtering              |
| `/packages/core/src/error-tracking/coercers/error-coercer.ts`           | Native Error exception type extraction           |
| `/packages/core/src/error-tracking/coercers/promise-rejection-event.ts` | Promise rejection exception type extraction      |
| `/packages/core/src/error-tracking/coercers/dom-exception-coercer.ts`   | DOM exception type extraction                    |
| `/packages/core/src/error-tracking/coercers/string-coercer.ts`          | Fallback for string errors                       |
| `/packages/core/src/error-tracking/coercers/primitive-coercer.ts`       | Fallback for primitive errors                    |
| `/packages/core/src/error-tracking/coercers/object-coercer.ts`          | Fallback for plain object errors                 |
| `/packages/core/src/error-tracking/error-properties-builder.ts`         | Exception property extraction orchestration      |
| `/packages/browser/src/request-queue.ts`                                | Exception event batching                         |
| `/packages/browser/src/request.ts`                                      | Global event rate limiter                        |

---

## Summary

The PostHog JavaScript SDK implements a sophisticated **per-exception-type token bucket rate limiter** that:

1. **Isolates exception types** with independent token buckets
2. **Prevents flooding** with configurable burst limits (default: 10 per type)
3. **Sustains capture** at a steady rate (default: 1 per 10 seconds per type)
4. **Preserves visibility** across different error types even during exception storms
5. **Operates transparently** with automatic bucket creation and management

This design ensures that a flood of one exception type (e.g., TypeErrors from a buggy feature) doesn't prevent other critical exceptions (e.g., ReferenceErrors from a separate issue) from being captured and reported.

**Core takeaway:** Different exception types are bucketed differently, with each type maintaining its own independent rate limit quota.

---

_Document generated based on PostHog JavaScript SDK codebase analysis_
