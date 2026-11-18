import {
    closeSync,
    ftruncateSync,
    openSync,
    promises as fs,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
    writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

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

/** Exclusively owned local storage. Call load before use; mutations must go through set. */
export class ElectronStorage {
    private stopped = false
    private owned = false
    private readonly owner = JSON.stringify({ host: hostname(), pid: process.pid, token: randomUUID() })
    private stopping?: Promise<void>
    private values: Values = Object.create(null)
    private serialized = JSON.stringify({ version: 1, values: {} })
    private revision = 0
    private queueExpiresAt = Infinity
    private persistedRevision = 0
    private pending?: Promise<void>
    private failure?: { error: unknown }
    private loading?: Promise<void>
    private loaded = false
    // Temp file whose rename has been submitted and may still land after the final exit write.
    private renaming?: string
    private finalized = false
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
        this.loading ??= this.loadState().finally(() => {
            this.loaded = true
        })
        await this.loading
    }

    get isLoaded(): boolean {
        return this.loaded
    }

    get isOwned(): boolean {
        return this.owned && !this.stopped
    }

    private async acquire(): Promise<void> {
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
        await fs.chmod(this.directory, 0o700)
        const lock = join(this.directory, '.owner')
        try {
            await fs.writeFile(lock, this.owner, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            const previous = await fs.readFile(lock, 'utf8')
            const owner: unknown = JSON.parse(previous)
            if (
                !isObject(owner) ||
                owner.host !== hostname() ||
                !Number.isSafeInteger(owner.pid) ||
                (owner.pid as number) <= 0 ||
                typeof owner.token !== 'string' ||
                !/^[a-f0-9-]{36}$/.test(owner.token)
            )
                throw new Error('Unverifiable Electron storage ownership')
            try {
                process.kill(owner.pid as number, 0)
                throw new Error('Electron storage is already owned by another process')
            } catch (probeError) {
                if ((probeError as NodeJS.ErrnoException).code !== 'ESRCH') throw probeError
            }
            // Never delete this tombstone: only one reclaimer may remove this owner generation.
            // A crashed reclaimer requires manual recovery with all application processes stopped.
            await fs.writeFile(join(this.directory, `.reclaim-${owner.token}`), '', { mode: 0o600, flag: 'wx' })
            if ((await fs.readFile(lock, 'utf8')) !== previous) throw new Error('Electron storage owner changed')
            await fs.unlink(lock)
            await fs.writeFile(lock, this.owner, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        }
        this.owned = true
    }

    private async loadState(): Promise<void> {
        try {
            if (this.stopped) return
            await this.acquire()
            if (this.stopped) return
        } catch (error) {
            this.values = Object.assign(Object.create(null), { opted_out: true })
            this.report(error)
            return
        }
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
            this.queueExpiresAt = bounded.expiresAt
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
        this.queueExpiresAt = Infinity
        this.serialized = JSON.stringify({ version: 1, values: this.values })
        this.revision++
        this.report(error)
        this.scheduleWrite()
    }

    get<T>(key: string): T | undefined {
        if (key === 'queue' && this.isOwned && Date.now() > this.queueExpiresAt) {
            const bounded = this.bound(this.values)
            if (bounded.serialized !== this.serialized) {
                this.values = bounded.values
                this.serialized = bounded.serialized
                this.queueExpiresAt = bounded.expiresAt
                this.revision++
                this.scheduleWrite()
            }
        }
        if (!Object.hasOwn(this.values, key)) return undefined
        const value = this.values[key]
        return (key === 'queue' && Array.isArray(value) ? value.slice() : structuredClone(value)) as T
    }

    set<T>(key: string, value: T | null): void {
        if (!this.isOwned) return
        const next: Values = Object.assign(Object.create(null), this.values)
        try {
            if (value === null) {
                delete next[key]
            } else {
                next[key] = structuredClone(value)
            }
            const bounded = this.bound(next)
            this.values = bounded.values
            this.serialized = bounded.serialized
            this.queueExpiresAt = bounded.expiresAt
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
        if (!this.isOwned) return
        // Retention also applies when the queue has been idle since the last write.
        if (Date.now() > this.queueExpiresAt) {
            const bounded = this.bound(this.values)
            this.values = bounded.values
            this.serialized = bounded.serialized
            this.queueExpiresAt = bounded.expiresAt
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

    private bound(input: Values): { values: Values; serialized: string; expiresAt: number } {
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
            queue = queue.filter((_, index) => !removed.has(index))
            values.queue = queue
            serialized = JSON.stringify({ version: 1, values })
        }
        if (Buffer.byteLength(serialized, 'utf8') > this.maxStorageBytes) {
            throw new RangeError('Electron storage exceeds maxStorageBytes after removing queued events')
        }
        const expiresAt =
            queue?.reduce((next, item) => Math.min(next, eventTime(item) + this.maxQueueAgeMs), Infinity) ?? Infinity
        return { values, serialized, expiresAt }
    }

    /** Final process-exit only: never race asynchronous loading, writing or ownership release. */
    releaseOnExit(): void {
        if (!this.owned || !this.loaded || this.stopping || this.stopped) return
        // The SDK never blocks quit, so persist unsaved state (notably consent) with a blocking write.
        if (this.persistedRevision < this.revision) this.writeOnExit()
        // An older async rename may still land after this; keep ownership as before.
        if (this.pending) return
        this.stopped = true
        const lock = join(this.directory, '.owner')
        try {
            if (readFileSync(lock, 'utf8') === this.owner) unlinkSync(lock)
        } catch (error) {
            this.report(error)
        } finally {
            this.owned = false
        }
    }

    stop(): Promise<void> {
        this.stopped = true
        return (this.stopping ??= (async () => {
            await this.loading
            await this.pending?.catch(() => {})
            if (!this.owned) return
            const lock = join(this.directory, '.owner')
            try {
                if ((await fs.readFile(lock, 'utf8')) === this.owner) await fs.unlink(lock)
            } catch (error) {
                this.report(error)
            } finally {
                this.owned = false
            }
        })())
    }

    private scheduleWrite(): void {
        if (!this.isOwned || this.pending) {
            return
        }
        this.failure = undefined
        let attemptedRevision = this.persistedRevision
        const pending = Promise.resolve().then(async () => {
            while (!this.stopped && this.persistedRevision < this.revision) {
                attemptedRevision = this.revision
                const serialized = this.serialized
                await this.write(serialized)
                this.persistedRevision = Math.max(this.persistedRevision, attemptedRevision)
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

    private writeOnExit(): void {
        if (Buffer.byteLength(this.serialized, 'utf8') > this.maxStorageBytes) {
            this.report(new RangeError('Electron storage exceeds maxStorageBytes'))
            return
        }
        // A submitted rename cannot be cancelled. Overwrite its source in place first (never create it):
        // if it already landed, the rename below replaces it; otherwise it now carries the final state.
        if (this.renaming) {
            let fd: number | undefined
            try {
                fd = openSync(this.renaming, 'r+')
                ftruncateSync(fd, 0)
                writeSync(fd, this.serialized, 0, 'utf8')
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.report(error)
            } finally {
                if (fd !== undefined) closeSync(fd)
            }
        }
        const temporary = join(this.directory, `.state-${randomUUID()}.tmp`)
        try {
            writeFileSync(temporary, this.serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
            renameSync(temporary, this.file)
            this.persistedRevision = this.revision
            this.finalized = true
        } catch (error) {
            this.report(error)
            try {
                unlinkSync(temporary)
            } catch {}
        }
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
            if (this.finalized) return
            // stop() retains ownership until this already-started write settles.
            this.renaming = temporary
            await fs.rename(temporary, this.file)
        } finally {
            if (this.renaming === temporary) this.renaming = undefined
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
