import { clampToRange } from '../../utils/number-utils'
import { ErrorProperties } from './error-conversion'

export class ExceptionRateLimiter {
    // We refill the buckets every 10 seconds.
    // The default bucket size of 10 and refill rate of 1 means we
    // capture ten exceptions of a type before burst protection kicks in,
    // after which we capture one exception of each type every 10 seconds

    private _bucketSize = 10
    private _refillRate = 1
    private _exceptionBuckets: Record<string, number> = {}

    constructor(
        private readonly _options: {
            bucketSize?: number
            refillRate?: number
        } = {}
    ) {
        this._refillRate = clampToRange(
            this._options.refillRate ?? this._refillRate,
            0,
            100,
            'exception throttling refill rate'
        )
        this._bucketSize = clampToRange(
            this._options.bucketSize ?? this._bucketSize,
            0,
            100,
            'exception throttling bucket size'
        )
        setInterval(() => {
            this._refillBuckets()
        }, 10000)
    }

    private _refillBuckets = () => {
        Object.keys(this._exceptionBuckets).forEach((key) => {
            this._exceptionBuckets[key] = this._exceptionBuckets[key] + this._refillRate

            if (this._exceptionBuckets[key] >= this._bucketSize) {
                delete this._exceptionBuckets[key]
            }
        })
    }

    public isRateLimited = (properties: ErrorProperties) => {
        const exception = properties.$exception_list[0]
        const exceptionType = exception?.type ?? 'Exception'

        const bucketSize = this._exceptionBuckets[exceptionType] ?? this._bucketSize

        if (bucketSize === 0) {
            return true
        }

        this._exceptionBuckets[exceptionType] = Math.max(bucketSize - 1, 0)

        return false
    }
}
