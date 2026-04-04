import { logger } from './utils/logger'

const DLQ_DB_NAME = 'posthog_dlq'
const DLQ_STORE_NAME = 'events'
const DLQ_DB_VERSION = 1

export interface StoredEvent {
    uuid: string
    data: Record<string, any>
    stored_at: number
}

export interface DlqMetrics {
    writes: number
    reads: number
    deletes: number
    errors: number
    evictions: number
}

export class OfflineDlq {
    private _db: IDBDatabase | null = null
    private _isAvailable: boolean = false
    private _maxAgeMs: number
    private _maxEntries: number
    metrics: DlqMetrics = { writes: 0, reads: 0, deletes: 0, errors: 0, evictions: 0 }

    constructor(maxAgeHours: number, maxEntries: number) {
        this._maxAgeMs = maxAgeHours * 60 * 60 * 1000
        this._maxEntries = maxEntries
    }

    get isAvailable(): boolean {
        return this._isAvailable
    }

    async open(): Promise<boolean> {
        try {
            const idb = this._getIndexedDB()
            if (!idb) {
                return false
            }

            this._db = await this._openDatabase(idb)
            this._isAvailable = true
            return true
        } catch (e) {
            logger.warn('[DLQ] Failed to open IndexedDB', e)
            this.metrics.errors++
            this._isAvailable = false
            return false
        }
    }

    private _getIndexedDB(): IDBFactory | null {
        try {
            return typeof indexedDB !== 'undefined' ? indexedDB : null
        } catch {
            return null
        }
    }

    private _openDatabase(idb: IDBFactory): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const request = idb.open(DLQ_DB_NAME, DLQ_DB_VERSION)

            request.onupgradeneeded = () => {
                const db = request.result
                if (!db.objectStoreNames.contains(DLQ_STORE_NAME)) {
                    db.createObjectStore(DLQ_STORE_NAME, { keyPath: 'uuid' })
                }
            }

            request.onsuccess = () => {
                const db = request.result
                db.onversionchange = () => {
                    db.close()
                    this._db = null
                    this._isAvailable = false
                }
                resolve(db)
            }

            request.onerror = () => reject(request.error)
        })
    }

    private async _ensureDb(): Promise<IDBDatabase | null> {
        if (this._db) {
            return this._db
        }
        // Single-retry re-open if connection was invalidated
        const opened = await this.open()
        return opened ? this._db : null
    }

    async write(events: StoredEvent[]): Promise<void> {
        if (events.length === 0) {
            return
        }
        let db: IDBDatabase | null
        try {
            db = await this._ensureDb()
        } catch {
            this.metrics.errors++
            return
        }
        if (!db) {
            return
        }

        try {
            const tx = db.transaction(DLQ_STORE_NAME, 'readwrite')
            const store = tx.objectStore(DLQ_STORE_NAME)

            for (const event of events) {
                store.put(event)
            }

            await this._txComplete(tx)
            this.metrics.writes += events.length
        } catch (e: any) {
            if (e?.name === 'InvalidStateError') {
                this._db = null
                this._isAvailable = false
            }
            logger.warn('[DLQ] Write failed', e)
            this.metrics.errors++
        }
    }

    async readAll(): Promise<StoredEvent[]> {
        let db: IDBDatabase | null
        try {
            db = await this._ensureDb()
        } catch {
            this.metrics.errors++
            return []
        }
        if (!db) {
            return []
        }

        try {
            const tx = db.transaction(DLQ_STORE_NAME, 'readonly')
            const store = tx.objectStore(DLQ_STORE_NAME)
            const request = store.getAll()

            return await new Promise<StoredEvent[]>((resolve, reject) => {
                request.onsuccess = () => {
                    this.metrics.reads++
                    resolve(request.result ?? [])
                }
                request.onerror = () => reject(request.error)
            })
        } catch (e: any) {
            if (e?.name === 'InvalidStateError') {
                this._db = null
                this._isAvailable = false
            }
            logger.warn('[DLQ] ReadAll failed', e)
            this.metrics.errors++
            return []
        }
    }

    async delete(uuids: string[]): Promise<void> {
        if (uuids.length === 0) {
            return
        }
        let db: IDBDatabase | null
        try {
            db = await this._ensureDb()
        } catch {
            this.metrics.errors++
            return
        }
        if (!db) {
            return
        }

        try {
            const tx = db.transaction(DLQ_STORE_NAME, 'readwrite')
            const store = tx.objectStore(DLQ_STORE_NAME)

            for (const uuid of uuids) {
                store.delete(uuid)
            }

            await this._txComplete(tx)
            this.metrics.deletes += uuids.length
        } catch (e: any) {
            if (e?.name === 'InvalidStateError') {
                this._db = null
                this._isAvailable = false
            }
            logger.warn('[DLQ] Delete failed', e)
            this.metrics.errors++
        }
    }

    async evictExpired(): Promise<number> {
        const db = this._db
        if (!db) {
            return 0
        }

        try {
            const cutoff = Date.now() - this._maxAgeMs
            const events = await this.readAll()
            const expired = events.filter((e) => e.stored_at < cutoff)

            if (expired.length > 0) {
                await this.delete(expired.map((e) => e.uuid))
                this.metrics.evictions += expired.length
            }

            return expired.length
        } catch (e) {
            logger.warn('[DLQ] EvictExpired failed', e)
            this.metrics.errors++
            return 0
        }
    }

    async enforceMaxEntries(): Promise<number> {
        const db = this._db
        if (!db) {
            return 0
        }

        try {
            const events = await this.readAll()
            if (events.length <= this._maxEntries) {
                return 0
            }

            // Sort by stored_at ascending to remove oldest first
            events.sort((a, b) => a.stored_at - b.stored_at)
            const excess = events.slice(0, events.length - this._maxEntries)

            await this.delete(excess.map((e) => e.uuid))
            this.metrics.evictions += excess.length

            return excess.length
        } catch (e) {
            logger.warn('[DLQ] EnforceMaxEntries failed', e)
            this.metrics.errors++
            return 0
        }
    }

    async clear(): Promise<void> {
        const db = this._db
        if (!db) {
            return
        }

        try {
            const tx = db.transaction(DLQ_STORE_NAME, 'readwrite')
            const store = tx.objectStore(DLQ_STORE_NAME)
            store.clear()
            await this._txComplete(tx)
        } catch (e) {
            logger.warn('[DLQ] Clear failed', e)
            this.metrics.errors++
        }
    }

    close(): void {
        this._db?.close()
        this._db = null
        this._isAvailable = false
    }

    private _txComplete(tx: IDBTransaction): Promise<void> {
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error)
            tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'))
        })
    }
}
