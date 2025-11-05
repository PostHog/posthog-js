# Implementation Plan: Token Bucket Rate Limiting Analysis for Exception Types

**Task ID:** c55a6828-158f-4054-a002-370e6e116dec  
**Generated:** 2025-11-05

## Summary

This is an **analysis and documentation task** rather than an implementation task. The goal is to explain how the PostHog JavaScript SDK implements token bucket rate limiting for exception tracking, with specific focus on how different exception types are bucketed independently.

The SDK uses a sophisticated **per-exception-type token bucket system** where each exception type (TypeError, ReferenceError, etc.) gets its own independent rate limiting bucket. This prevents one type of exception from consuming rate limit quota for other exception types.

## Core Architecture

### Token Bucket Implementation

**Location:** `/packages/core/src/utils/bucketed-rate-limiter.ts`

The `BucketedRateLimiter<T>` class implements a generic bucketed token bucket algorithm:

- **Generic key-based design**: Uses a `Map<T, BucketState>` to maintain separate buckets per key
- **Default configuration**: 10 tokens per bucket, refills 1 token per 10-second interval
- **Interval-based refill**: Tokens refill only on complete intervals, not partial time periods
- **Independent buckets**: Each key's bucket operates completely independently with its own token count and refill timing

**Key method:** `consumeRateLimit(key: T): boolean`

- Returns `true` if rate limited (bucket exhausted)
- Returns `false` if allowed (tokens available)
- Automatically handles token refill based on elapsed time

### Exception Type Bucketing

**Location:** `/packages/browser/src/extensions/exception-autocapture/index.ts` (lines 142-154)

**How exception types become bucket keys:**

1. **Type Extraction**: Exception type is extracted from `errorProperties?.$exception_list?.[0]?.type ?? 'Exception'`
2. **Bucket Key Assignment**: The exception type string (e.g., `'TypeError'`, `'ReferenceError'`) is used as the bucket key
3. **Rate Limit Check**: `this._rateLimiter.consumeRateLimit(exceptionType)` determines if this specific exception type has available tokens

**Example exception types that get separate buckets:**

- `'Error'` - Generic JavaScript errors
- `'TypeError'` - Type-related errors
- `'ReferenceError'` - Reference errors
- `'PromiseRejectionEvent'` - Unhandled promise rejections
- `'DOMException'` - DOM-related exceptions
- `'SyntaxError'` - Syntax errors
- `'RangeError'` - Range errors
- etc.

## Exception Type Classification Pipeline

**Location:** `/packages/core/src/error-tracking/coercers/`

The SDK uses multiple "coercers" to classify exceptions from different sources:

| Coercer                      | Input Type                   | Output Exception Type                        |
| ---------------------------- | ---------------------------- | -------------------------------------------- |
| `error-coercer.ts`           | Native Error objects         | `Error`, `TypeError`, `ReferenceError`, etc. |
| `promise-rejection-event.ts` | Unhandled promise rejections | `PromiseRejectionEvent`                      |
| `error-event-coercer.ts`     | ErrorEvent objects           | Event-derived type                           |
| `dom-exception-coercer.ts`   | DOMException objects         | `DOMException`                               |
| `string-coercer.ts`          | String errors                | `'Exception'`                                |
| `primitive-coercer.ts`       | Primitive values             | `'Exception'`                                |
| `object-coercer.ts`          | Object errors                | `'Exception'`                                |

The `ErrorPropertiesBuilder` orchestrates these coercers and uses platform-specific stack trace parsers (Chrome, Safari, Firefox, Node, React Native) to extract exception type information.

## Rate Limiting Configuration

**Default Configuration** (lines 29-34 in `exception-autocapture/index.ts`):

```typescript
{
  bucketSize: 10,        // 10 tokens per exception type
  refillRate: 1,         // 1 token added per interval
  refillInterval: 10000  // 10 seconds (10,000ms)
}
```

**Result:** Each exception type can send:

- Initial burst: 10 exceptions immediately
- Sustained rate: 1 exception per 10 seconds thereafter

**Customization Options:**

```typescript
new PostHog({
    error_tracking: {
        __exceptionRateLimiterBucketSize: 10, // Configurable
        __exceptionRateLimiterRefillRate: 1, // Configurable
        // refillInterval is hardcoded to 10000ms
    },
})
```

## Complete Exception Flow with Rate Limiting

```
1. Exception occurs
   ↓
2. Global handlers catch (window.onerror, unhandledrejection, console.error)
   ↓
3. ErrorPropertiesBuilder extracts exception type via coercers
   ↓
4. ExceptionObserver.captureException() → RATE LIMIT CHECK (per exception type)
   ├─ Rate limited (true) → Exception dropped, log message generated
   └─ Allowed (false) → Continue to step 5
   ↓
5. PostHogExceptions.sendExceptionEvent() → Additional filtering
   ├─ Suppression rules check (server-defined)
   ├─ Extension exception filter (chrome-extension:// URLs)
   └─ SDK self-exception filter (PostHog SDK internal errors)
   ↓
6. Event queue with _batchKey: 'exceptionEvent' (separate batching)
   ↓
7. Batch flush (3-second interval)
   ↓
8. Send to /e/ endpoint
   ↓
9. Global event rate limiter (10 events/sec, burst 100)
```

## Two Independent Rate Limiting Systems

The SDK implements **two separate, independent rate limiting mechanisms**:

### 1. Exception-Specific Bucketed Rate Limiter

- **Class:** `BucketedRateLimiter` in ExceptionObserver
- **Scope:** Per-exception-type
- **Location in pipeline:** First filter (before event queuing)
- **Configuration:** `error_tracking.__exceptionRateLimiter*` options
- **Behavior:** Each exception type has independent token bucket

### 2. Global Event Rate Limiter

- **Class:** `RateLimiter` in request.ts
- **Scope:** All events (not exception-specific)
- **Location in pipeline:** Before network transmission
- **Configuration:** Default 10 events/sec, burst limit 100
- **Behavior:** Uses persistent storage, respects server quota headers

## Key Implementation Details

### Independent Bucket Behavior

**Critical characteristic:** Buckets are completely independent

Example scenario:

```
Time 0s:
- TypeError bucket: 10 tokens (full)
- ReferenceError bucket: 10 tokens (full)

Time 1s: Send 10 TypeErrors
- TypeError bucket: 0 tokens (exhausted)
- ReferenceError bucket: 10 tokens (unchanged)

Time 2s: Send 11th TypeError
- Result: RATE LIMITED (dropped)

Time 2s: Send 1st ReferenceError
- Result: ALLOWED (separate bucket)
```

### Token Refill Mechanism

**Location:** `bucketed-rate-limiter.ts` `_refillBucket()` method

- Calculates elapsed time since `lastAccess`
- Determines number of complete intervals: `Math.floor(elapsedTime / refillInterval)`
- Adds tokens: `tokensToAdd = intervals * refillRate`
- Caps at bucket size: `Math.min(currentTokens + tokensToAdd, bucketSize)`
- **No partial interval refills** - must wait for complete 10-second intervals

### Rate Limit Callback

The rate limiter supports an optional callback when buckets are exhausted:

```typescript
_onBucketRateLimited?: (key: T) => void
```

Used for logging: When a specific exception type is rate limited, a log message is generated indicating which type was dropped.

## Answer Key to Questions

**Q1: How does the SDK implement token bucket rate limiting?**
→ Uses separate independent token buckets for each exception type (TypeError, ReferenceError, etc.)

**Q2: Default token bucket configuration?**
→ Bucket size: 10 tokens, refill rate: 1 token per 10 seconds

**Q3: Where is exception type extracted?**
→ From `errorProperties.$exception_list[0].type` field

**Q4: How many rate limiting systems?**
→ Two: exception-specific bucketed rate limiter and global event rate limiter

**Q5: What happens when bucket exhausted?**
→ The exception is dropped and a log message is generated

**Q6: Core implementation files?**
→ `/packages/core/src/utils/bucketed-rate-limiter.ts` and `/packages/browser/src/extensions/exception-autocapture/index.ts`

**Q7: Are buckets independent?**
→ Yes, each exception type has its own independent token bucket with separate token allocation

**Q8: How is exception type used?**
→ It's used as the bucket key for per-type rate limiting

**Q9: Filtering layers after rate limiting?**
→ Suppression rules, extension exception filter, and SDK self-exception filter

**Q10: Is configuration customizable?**
→ Yes, via `error_tracking.__exceptionRateLimiterBucketSize` and `__exceptionRateLimiterRefillRate` config options

## File Reference Guide

| File Path                                                         | Purpose                                          |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| `/packages/core/src/utils/bucketed-rate-limiter.ts`               | Generic bucketed token bucket implementation     |
| `/packages/browser/src/extensions/exception-autocapture/index.ts` | Exception observer with rate limiter integration |
| `/packages/browser/src/posthog-exceptions.ts`                     | Post-rate-limit exception filtering              |
| `/packages/core/src/error-tracking/coercers/*.ts`                 | Exception type classification                    |
| `/packages/core/src/error-tracking/error-properties-builder.ts`   | Exception property extraction orchestration      |
| `/packages/browser/src/request-queue.ts`                          | Exception event batching                         |
| `/packages/browser/src/request.ts`                                | Global event rate limiter                        |

---

_Generated by PostHog Agent_
