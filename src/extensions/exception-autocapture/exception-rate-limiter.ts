import { clampToRange } from '../../utils/number-utils'
import { ErrorProperties } from './error-conversion'

export class ExceptionRateLimiter {
    private _bucketSize = 100
    private _refillRate = 10
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
        }, 1000)
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

        if (!exception) {
            return false
        }

        const exceptionType = exception.type || 'default'

        this._exceptionBuckets[exceptionType] = this._exceptionBuckets[exceptionType] ?? this._bucketSize

        if (this._exceptionBuckets[exceptionType] === 0) {
            return true
        }

        this._exceptionBuckets[exceptionType] = Math.max(this._exceptionBuckets[exceptionType] - 1, 0)

        return false
    }
}
