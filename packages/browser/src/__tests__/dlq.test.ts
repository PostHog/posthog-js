/* eslint-disable compat/compat */

// jsdom doesn't expose structuredClone but fake-indexeddb v6 requires it
if (typeof globalThis.structuredClone === 'undefined') {
    globalThis.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val))
}

import 'fake-indexeddb/auto'
import { OfflineDlq, StoredEvent } from '../dlq'

function makeEvent(uuid: string, storedAt?: number): StoredEvent {
    return {
        uuid,
        data: { event: 'test', uuid, properties: { token: 'test-token' } },
        stored_at: storedAt ?? Date.now(),
    }
}

describe('OfflineDlq', () => {
    let dlq: OfflineDlq

    beforeEach(async () => {
        dlq = new OfflineDlq(24, 1000)
        await dlq.open()
    })

    afterEach(async () => {
        await dlq.clear()
        dlq.close()
    })

    describe('open', () => {
        it('opens successfully', async () => {
            const newDlq = new OfflineDlq(24, 1000)
            const result = await newDlq.open()
            expect(result).toBe(true)
            expect(newDlq.isAvailable).toBe(true)
            newDlq.close()
        })
    })

    describe('write', () => {
        it('stores events', async () => {
            const events = [makeEvent('uuid-1'), makeEvent('uuid-2')]
            await dlq.write(events)

            const stored = await dlq.readAll()
            expect(stored).toHaveLength(2)
            expect(stored.map((e) => e.uuid).sort()).toEqual(['uuid-1', 'uuid-2'])
        })

        it('deduplicates via ConstraintError', async () => {
            const event = makeEvent('uuid-dup')
            await dlq.write([event])
            await dlq.write([event])

            const stored = await dlq.readAll()
            expect(stored).toHaveLength(1)
        })

        it('re-opens and writes when db was closed (single-retry re-open)', async () => {
            dlq.close()
            expect(dlq.isAvailable).toBe(false)
            await dlq.write([makeEvent('uuid-reopen')])
            expect(dlq.isAvailable).toBe(true)
            expect(dlq.metrics.writes).toBe(1)
            const stored = await dlq.readAll()
            expect(stored).toHaveLength(1)
        })

        it('handles empty array', async () => {
            await dlq.write([])
            expect(dlq.metrics.writes).toBe(0)
        })
    })

    describe('readAll', () => {
        it('returns empty on empty store', async () => {
            const stored = await dlq.readAll()
            expect(stored).toEqual([])
        })

        it('returns all stored events', async () => {
            await dlq.write([makeEvent('a'), makeEvent('b'), makeEvent('c')])
            const stored = await dlq.readAll()
            expect(stored).toHaveLength(3)
        })
    })

    describe('delete', () => {
        it('removes events by UUID', async () => {
            await dlq.write([makeEvent('del-1'), makeEvent('del-2'), makeEvent('del-3')])
            await dlq.delete(['del-1', 'del-3'])

            const stored = await dlq.readAll()
            expect(stored).toHaveLength(1)
            expect(stored[0].uuid).toBe('del-2')
        })

        it('handles empty array', async () => {
            await dlq.delete([])
            expect(dlq.metrics.deletes).toBe(0)
        })
    })

    describe('evictExpired', () => {
        it('removes old entries', async () => {
            const now = Date.now()
            const oldEvent = makeEvent('old', now - 25 * 60 * 60 * 1000) // 25 hours ago
            const freshEvent = makeEvent('fresh', now)

            await dlq.write([oldEvent, freshEvent])
            const evicted = await dlq.evictExpired()

            expect(evicted).toBe(1)
            const stored = await dlq.readAll()
            expect(stored).toHaveLength(1)
            expect(stored[0].uuid).toBe('fresh')
        })

        it('returns 0 when nothing expired', async () => {
            await dlq.write([makeEvent('recent')])
            const evicted = await dlq.evictExpired()
            expect(evicted).toBe(0)
        })
    })

    describe('enforceMaxEntries', () => {
        it('caps size by removing oldest first', async () => {
            const smallDlq = new OfflineDlq(24, 3)
            await smallDlq.open()

            const now = Date.now()
            const events = [
                makeEvent('e1', now - 4000),
                makeEvent('e2', now - 3000),
                makeEvent('e3', now - 2000),
                makeEvent('e4', now - 1000),
                makeEvent('e5', now),
            ]
            await smallDlq.write(events)

            const removed = await smallDlq.enforceMaxEntries()
            expect(removed).toBe(2)

            const stored = await smallDlq.readAll()
            expect(stored).toHaveLength(3)
            const uuids = stored.map((e) => e.uuid).sort()
            expect(uuids).toEqual(['e3', 'e4', 'e5'])

            await smallDlq.clear()
            smallDlq.close()
        })

        it('does nothing when under limit', async () => {
            await dlq.write([makeEvent('under1'), makeEvent('under2')])
            const removed = await dlq.enforceMaxEntries()
            expect(removed).toBe(0)
        })
    })

    describe('clear', () => {
        it('removes all events', async () => {
            await dlq.write([makeEvent('c1'), makeEvent('c2')])
            await dlq.clear()

            const stored = await dlq.readAll()
            expect(stored).toEqual([])
        })
    })

    describe('close', () => {
        it('marks dlq as unavailable', () => {
            expect(dlq.isAvailable).toBe(true)
            dlq.close()
            expect(dlq.isAvailable).toBe(false)
        })
    })

    describe('metrics', () => {
        it('tracks writes', async () => {
            await dlq.write([makeEvent('m1'), makeEvent('m2')])
            expect(dlq.metrics.writes).toBe(2)
        })

        it('tracks reads', async () => {
            await dlq.readAll()
            expect(dlq.metrics.reads).toBe(1)
        })

        it('tracks deletes', async () => {
            await dlq.write([makeEvent('d1')])
            await dlq.delete(['d1'])
            expect(dlq.metrics.deletes).toBe(1)
        })

        it('tracks evictions', async () => {
            const now = Date.now()
            await dlq.write([makeEvent('old', now - 25 * 60 * 60 * 1000)])
            await dlq.evictExpired()
            expect(dlq.metrics.evictions).toBe(1)
        })
    })
})
