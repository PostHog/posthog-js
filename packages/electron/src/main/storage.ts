import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const DEFAULT_MAX_STORAGE_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000

type StorageOptions = {
    maxStorageBytes?: number
    maxQueueAgeMs?: number
    onError?: (error: unknown) => void
}

type Values = Record<string, unknown>
type QueueItem = { message: { timestamp: string | Date } }

function isObject(value: unknown): value is Values {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function eventTime(item: QueueItem): number {
    return new Date(item.message.timestamp).getTime()
}

function isQueueItem(value: unknown): value is QueueItem {
    if (!isObject(value) || !Object.hasOwn(value, 'message') || !isObject(value.message)) {
        return false
    }
    const message = value.message
    return (
        Object.hasOwn(message, 'timestamp') &&
        (typeof message.timestamp === 'string' || message.timestamp instanceof Date) &&
        Number.isFinite(new Date(message.timestamp).getTime()) &&
        Object.hasOwn(message, 'event') &&
        typeof message.event === 'string' &&
        Object.hasOwn(message, 'distinct_id') &&
        typeof message.distinct_id === 'string' &&
        Object.hasOwn(message, 'properties') &&
        isObject(message.properties)
    )
}

/** Single-process storage. Call load before using the store; mutations must go through set. */
export class ElectronStorage {
    private stopped = false
    private values: Values = Object.create(null)
    private serialized = JSON.stringify({ version: 1, values: {} })
    private revision = 0
    private persistedRevision = 0
    private pending?: Promise<void>
    private failure?: { error: unknown }
    private loading?: Promise<void>
    private readonly maxStorageBytes: number
    private readonly maxQueueAgeMs: number
    private readonly file: string

    constructor(
        private readonly directory: string,
        private readonly options: StorageOptions = {}
    ) {
        this.file = join(directory, 'state.json')
        this.maxStorageBytes = options.maxStorageBytes ?? DEFAULT_MAX_STORAGE_BYTES
        this.maxQueueAgeMs = options.maxQueueAgeMs ?? DEFAULT_MAX_QUEUE_AGE_MS
        if (!Number.isFinite(this.maxStorageBytes) || this.maxStorageBytes <= 0) {
            throw new RangeError('maxStorageBytes must be positive and finite')
        }
        if (!Number.isFinite(this.maxQueueAgeMs) || this.maxQueueAgeMs < 0) {
            throw new RangeError('maxQueueAgeMs must be nonnegative and finite')
        }
    }

    async load(): Promise<void> {
        this.loading ??= this.loadState()
        await this.loading
    }

    private async loadState(): Promise<void> {
        let text: string
        try {
            text = await fs.readFile(this.file, 'utf8')
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return
            }
            this.recover(error)
            return
        }
        if (this.stopped) return
        try {
            const state: unknown = JSON.parse(text)
            if (
                !isObject(state) ||
                !Object.hasOwn(state, 'version') ||
                state.version !== 1 ||
                !Object.hasOwn(state, 'values') ||
                !isObject(state.values) ||
                (Object.hasOwn(state.values, 'opted_out') && typeof state.values.opted_out !== 'boolean')
            ) {
                throw new Error('Invalid Electron storage schema')
            }
            const bounded = this.bound(state.values)
            this.values = bounded.values
            this.serialized = bounded.serialized
            if (this.serialized !== text) {
                this.revision++
                this.scheduleWrite()
            }
        } catch (error) {
            this.recover(error)
        }
    }

    private recover(error: unknown): void {
        if (this.stopped) return
        // Consent cannot safely be inferred from unreadable state. Discard all analytics.
        this.values = Object.assign(Object.create(null), { opted_out: true })
        this.serialized = JSON.stringify({ version: 1, values: this.values })
        this.revision++
        this.report(error)
        this.scheduleWrite()
    }

    get<T>(key: string): T | undefined {
        if (key === 'queue' && !this.stopped) {
            const bounded = this.bound(this.values)
            if (bounded.serialized !== this.serialized) {
                this.values = bounded.values
                this.serialized = bounded.serialized
                this.revision++
                this.scheduleWrite()
            }
        }
        return Object.hasOwn(this.values, key) ? (this.values[key] as T) : undefined
    }

    set<T>(key: string, value: T | null): void {
        if (this.stopped) return
        const next: Values = Object.assign(Object.create(null), this.values)
        if (value === null) {
            delete next[key]
        } else {
            next[key] = value
        }
        try {
            const bounded = this.bound(next)
            this.values = bounded.values
            this.serialized = bounded.serialized
        } catch (error) {
            this.report(error)
            // In particular, callers must not mistake rejected consent changes for durable ones.
            throw error
        }
        this.revision++
        this.scheduleWrite()
    }

    /** Waits for atomic write completion, not an fsync/power-loss durability barrier. */
    async flush(): Promise<void> {
        if (this.stopped) return
        // Retention also applies when the queue has been idle since the last write.
        const bounded = this.bound(this.values)
        if (bounded.serialized !== this.serialized) {
            this.values = bounded.values
            this.serialized = bounded.serialized
            this.revision++
            this.scheduleWrite()
        }
        if (!this.pending && this.persistedRevision < this.revision) {
            this.scheduleWrite()
        }
        while (this.pending) {
            await this.pending
        }
        if (this.persistedRevision < this.revision && this.failure) {
            throw this.failure.error
        }
    }

    private bound(input: Values): { values: Values; serialized: string } {
        const values: Values = Object.assign(Object.create(null), input)
        let queue: QueueItem[] | undefined
        if (Object.hasOwn(values, 'queue')) {
            if (!Array.isArray(values.queue) || !values.queue.every(isQueueItem)) {
                throw new Error('Invalid Electron event queue')
            }
            const cutoff = Date.now() - this.maxQueueAgeMs
            queue = values.queue.filter((item) => eventTime(item) >= cutoff)
            values.queue = queue
        }
        let serialized = JSON.stringify({ version: 1, values })
        let bytes = Buffer.byteLength(serialized, 'utf8')
        if (bytes > this.maxStorageBytes && queue?.length) {
            const oldest = queue
                .map((item, index) => ({ item, index }))
                .sort((a, b) => eventTime(a.item) - eventTime(b.item))
            const removed = new Set<number>()
            for (const { item, index } of oldest) {
                if (bytes <= this.maxStorageBytes) {
                    break
                }
                bytes -= Buffer.byteLength(JSON.stringify(item), 'utf8') + (queue.length - removed.size > 1 ? 1 : 0)
                removed.add(index)
            }
            values.queue = queue.filter((_, index) => !removed.has(index))
            serialized = JSON.stringify({ version: 1, values })
        }
        if (Buffer.byteLength(serialized, 'utf8') > this.maxStorageBytes) {
            throw new RangeError('Electron storage exceeds maxStorageBytes after removing queued events')
        }
        return { values, serialized }
    }

    stop(): void {
        this.stopped = true
    }

    private scheduleWrite(): void {
        if (this.stopped || this.pending) {
            return
        }
        this.failure = undefined
        let attemptedRevision = this.persistedRevision
        const pending = Promise.resolve().then(async () => {
            while (!this.stopped && this.persistedRevision < this.revision) {
                attemptedRevision = this.revision
                const serialized = this.serialized
                await this.write(serialized)
                this.persistedRevision = attemptedRevision
            }
        })
        this.pending = pending
        // Attach a rejection handler even when the caller does not ask for a durability ack.
        void pending.then(
            () => {
                this.pending = undefined
                // A set can land between the worker returning and this settlement handler.
                if (this.persistedRevision < this.revision) {
                    this.scheduleWrite()
                }
            },
            (error: unknown) => {
                this.failure = { error }
                this.pending = undefined
                this.report(error)
                if (attemptedRevision < this.revision) {
                    this.scheduleWrite()
                }
            }
        )
    }

    private async write(serialized: string): Promise<void> {
        if (Buffer.byteLength(serialized, 'utf8') > this.maxStorageBytes) {
            throw new RangeError('Electron storage exceeds maxStorageBytes')
        }
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
        await fs.chmod(this.directory, 0o700)
        const temporary = join(this.directory, `.state-${randomUUID()}.tmp`)
        try {
            await fs.writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
            await fs.rename(temporary, this.file)
        } finally {
            await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
                if (error.code !== 'ENOENT') {
                    this.report(error)
                }
            })
        }
    }

    private report(error: unknown): void {
        try {
            this.options.onError?.(error)
        } catch {
            // Error reporting must never break storage recovery or background writes.
        }
    }
}
