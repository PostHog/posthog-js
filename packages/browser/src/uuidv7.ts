/**
 * uuidv7: An experimental implementation of the proposed UUID Version 7
 *
 * @license Apache-2.0
 * @copyright 2021-2023 LiosK
 * @packageDocumentation
 *
 * from https://github.com/LiosK/uuidv7/blob/e501462ea3d23241de13192ceae726956f9b3b7d/src/index.ts
 */

// polyfill for IE11
import { window } from './utils/globals'

import { isNumber, isUndefined } from '@posthog/core'

if (!Math.trunc) {
    Math.trunc = function (v) {
        return v < 0 ? Math.ceil(v) : Math.floor(v)
    }
}

// polyfill for IE11
if (!Number.isInteger) {
    Number.isInteger = function (value) {
        return isNumber(value) && isFinite(value) && Math.floor(value) === value
    }
}

const DIGITS = '0123456789abcdef'

/** Represents a UUID as a 16-byte byte array. */
export class UUID {
    /** @param bytes - The 16-byte byte array representation. */
    constructor(readonly bytes: Readonly<Uint8Array>) {
        if (bytes.length !== 16) {
            throw new TypeError('not 128-bit length')
        }
    }

    /**
     * Builds a byte array from UUIDv7 field values.
     *
     * @param unixTsMs - A 48-bit `unix_ts_ms` field value.
     * @param randA - A 12-bit `rand_a` field value.
     * @param randBHi - The higher 30 bits of 62-bit `rand_b` field value.
     * @param randBLo - The lower 32 bits of 62-bit `rand_b` field value.
     */
    static fromFieldsV7(unixTsMs: number, randA: number, randBHi: number, randBLo: number): UUID {
        if (
            !Number.isInteger(unixTsMs) ||
            !Number.isInteger(randA) ||
            !Number.isInteger(randBHi) ||
            !Number.isInteger(randBLo) ||
            unixTsMs < 0 ||
            randA < 0 ||
            randBHi < 0 ||
            randBLo < 0 ||
            unixTsMs > 0xffff_ffff_ffff ||
            randA > 0xfff ||
            randBHi > 0x3fff_ffff ||
            randBLo > 0xffff_ffff
        ) {
            throw new RangeError('invalid field value')
        }

        const bytes = new Uint8Array(16)
        bytes[0] = unixTsMs / 2 ** 40
        bytes[1] = unixTsMs / 2 ** 32
        bytes[2] = unixTsMs / 2 ** 24
        bytes[3] = unixTsMs / 2 ** 16
        bytes[4] = unixTsMs / 2 ** 8
        bytes[5] = unixTsMs
        bytes[6] = 0x70 | (randA >>> 8)
        bytes[7] = randA
        bytes[8] = 0x80 | (randBHi >>> 24)
        bytes[9] = randBHi >>> 16
        bytes[10] = randBHi >>> 8
        bytes[11] = randBHi
        bytes[12] = randBLo >>> 24
        bytes[13] = randBLo >>> 16
        bytes[14] = randBLo >>> 8
        bytes[15] = randBLo
        return new UUID(bytes)
    }

    /** @returns The 8-4-4-4-12 canonical hexadecimal string representation. */
    toString(): string {
        let text = ''
        for (let i = 0; i < this.bytes.length; i++) {
            text = text + DIGITS.charAt(this.bytes[i] >>> 4) + DIGITS.charAt(this.bytes[i] & 0xf)
            if (i === 3 || i === 5 || i === 7 || i === 9) {
                text += '-'
            }
        }

        if (text.length !== 36) {
            // We saw one customer whose bundling code was mangling the UUID generation
            // rather than accept a bad UUID, we throw an error here.
            throw new Error('Invalid UUIDv7 was generated')
        }
        return text
    }

    /** Creates an object from `this`. */
    clone(): UUID {
        return new UUID(this.bytes.slice(0))
    }

    /** Returns true if `this` is equivalent to `other`. */
    equals(other: UUID): boolean {
        return this.compareTo(other) === 0
    }

    /**
     * Returns a negative integer, zero, or positive integer if `this` is less
     * than, equal to, or greater than `other`, respectively.
     */
    compareTo(other: UUID): number {
        for (let i = 0; i < 16; i++) {
            const diff = this.bytes[i] - other.bytes[i]
            if (diff !== 0) {
                return Math.sign(diff)
            }
        }
        return 0
    }
}

/** Encapsulates the monotonic counter state. */
class V7Generator {
    private _timestamp = 0
    private _counter = 0
    private readonly _random = new DefaultRandom()

    /**
     * Generates a new UUIDv7 object from the current timestamp, or resets the
     * generator upon significant timestamp rollback.
     *
     * This method returns monotonically increasing UUIDs unless the up-to-date
     * timestamp is significantly (by ten seconds or more) smaller than the one
     * embedded in the immediately preceding UUID. If such a significant clock
     * rollback is detected, this method resets the generator and returns a new
     * UUID based on the current timestamp.
     */
    generate(): UUID {
        const value = this.generateOrAbort()
        if (!isUndefined(value)) {
            return value
        } else {
            // reset state and resume
            this._timestamp = 0
            const valueAfterReset = this.generateOrAbort()
            if (isUndefined(valueAfterReset)) {
                throw new Error('Could not generate UUID after timestamp reset')
            }
            return valueAfterReset
        }
    }

    /**
     * Generates a new UUIDv7 object from the current timestamp, or returns
     * `undefined` upon significant timestamp rollback.
     *
     * This method returns monotonically increasing UUIDs unless the up-to-date
     * timestamp is significantly (by ten seconds or more) smaller than the one
     * embedded in the immediately preceding UUID. If such a significant clock
     * rollback is detected, this method aborts and returns `undefined`.
     */
    generateOrAbort(): UUID | undefined {
        const MAX_COUNTER = 0x3ff_ffff_ffff
        const ROLLBACK_ALLOWANCE = 10_000 // 10 seconds

        const ts = Date.now()
        if (ts > this._timestamp) {
            this._timestamp = ts
            this._resetCounter()
        } else if (ts + ROLLBACK_ALLOWANCE > this._timestamp) {
            // go on with previous timestamp if new one is not much smaller
            this._counter++
            if (this._counter > MAX_COUNTER) {
                // increment timestamp at counter overflow
                this._timestamp++
                this._resetCounter()
            }
        } else {
            // abort if clock went backwards to unbearable extent
            return undefined
        }

        return UUID.fromFieldsV7(
            this._timestamp,
            Math.trunc(this._counter / 2 ** 30),
            this._counter & (2 ** 30 - 1),
            this._random.nextUint32()
        )
    }

    /** Initializes the counter at a 42-bit random integer. */
    private _resetCounter(): void {
        this._counter = this._random.nextUint32() * 0x400 + (this._random.nextUint32() & 0x3ff)
    }
}

/** A global flag to force use of cryptographically strong RNG. */
declare const UUIDV7_DENY_WEAK_RNG: boolean

/** Stores `crypto.getRandomValues()` available in the environment. */
let getRandomValues: <T extends Uint8Array | Uint32Array>(buffer: T) => T = (buffer) => {
    // fall back on Math.random() unless the flag is set to true
    // TRICKY: don't use the isUndefined method here as can't pass the reference
    if (typeof UUIDV7_DENY_WEAK_RNG !== 'undefined' && UUIDV7_DENY_WEAK_RNG) {
        throw new Error('no cryptographically strong RNG available')
    }

    for (let i = 0; i < buffer.length; i++) {
        buffer[i] = Math.trunc(Math.random() * 0x1_0000) * 0x1_0000 + Math.trunc(Math.random() * 0x1_0000)
    }
    return buffer
}

// detect Web Crypto API
if (window && !isUndefined(window.crypto) && crypto.getRandomValues) {
    getRandomValues = (buffer) => crypto.getRandomValues(buffer)
}

/**
 * Wraps `crypto.getRandomValues()` and compatibles to enable buffering; this
 * uses a small buffer by default to avoid unbearable throughput decline in some
 * environments as well as the waste of time and space for unused values.
 */
class DefaultRandom {
    private readonly _buffer = new Uint32Array(8)
    private _cursor = Infinity
    nextUint32(): number {
        if (this._cursor >= this._buffer.length) {
            getRandomValues(this._buffer)
            this._cursor = 0
        }
        return this._buffer[this._cursor++]
    }
}

let defaultGenerator: V7Generator | undefined

/**
 * Generates a UUIDv7 string.
 *
 * @returns The 8-4-4-4-12 canonical hexadecimal string representation
 * ("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx").
 */
export const uuidv7 = (): string => uuidv7obj().toString()

/** Generates a UUIDv7 object. */
const uuidv7obj = (): UUID => (defaultGenerator || (defaultGenerator = new V7Generator())).generate()

export const uuid7ToTimestampMs = (uuid: string): number => {
    // remove hyphens
    const hex = uuid.replace(/-/g, '')
    // ensure that it's a version 7 UUID
    if (hex.length !== 32) {
        throw new Error('Not a valid UUID')
    }
    if (hex[12] !== '7') {
        throw new Error('Not a UUIDv7')
    }
    // the first 6 bytes are the timestamp, which means that we can read only the first 12 hex characters
    return parseInt(hex.substring(0, 12), 16)
}
