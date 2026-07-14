import type { ExceptionBurstProtectionOptions } from '@posthog/types'
import { Logger } from '../types'
import { BucketedRateLimiter } from '../utils/bucketed-rate-limiter'

export const DEFAULT_BURST_PROTECTION_BUCKET_SIZE = 10
export const DEFAULT_BURST_PROTECTION_REFILL_RATE = 1
const BURST_PROTECTION_REFILL_INTERVAL_MS = 10000

// Burst protection semantics are documented on `ExceptionBurstProtectionOptions`:
// one token bucket per exception type, keyed via `getExceptionBucketKey`.
export function createExceptionRateLimiter(
  options: ExceptionBurstProtectionOptions | undefined,
  logger: Logger
): BucketedRateLimiter<string> {
  return new BucketedRateLimiter({
    bucketSize: options?.bucketSize ?? DEFAULT_BURST_PROTECTION_BUCKET_SIZE,
    refillRate: options?.refillRate ?? DEFAULT_BURST_PROTECTION_REFILL_RATE,
    refillInterval: BURST_PROTECTION_REFILL_INTERVAL_MS,
    _logger: logger,
  })
}

export function getExceptionBucketKey(properties?: { $exception_list?: { type?: string }[] }): string {
  return properties?.$exception_list?.[0]?.type ?? 'Exception'
}
