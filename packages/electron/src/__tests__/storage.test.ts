import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ElectronStorage } from '../main/storage'

const NOW = Date.parse('2026-01-10T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

function event(name: string, timestamp: string | Date = new Date(NOW)) {
    return { message: { event: name, distinct_id: 'person', properties: {}, timestamp, uuid: name } }
}

function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
        resolve = done
    })
    return { promise, resolve }
}

describe('ElectronStorage', () => {
    let directory: string
    const stores: ElectronStorage[] = []

    function storage(options?: ConstructorParameters<typeof ElectronStorage>[1]) {
        const store = new ElectronStorage(directory, options)
        stores.push(store)
        return store
    }

    async function diskState() {
        return JSON.parse(await fs.readFile(join(directory, 'state.json'), 'utf8'))
    }

    beforeEach(async () => {
        vi.spyOn(Date, 'now').mockReturnValue(NOW)
        directory = await fs.mkdtemp(join(tmpdir(), 'posthog-electron-storage-'))
    })

    afterEach(async () => {
        // Drain background writes before restoring filesystem spies or removing fixtures.
        await Promise.all(stores.splice(0).map((store) => store.flush().catch(() => {})))
        vi.restoreAllMocks()
        await fs.rm(directory, { recursive: true, force: true })
    })

    it.each(['nested mutation', 'cycle'] as const)('detaches accepted queue data from caller %s', async (change) => {
        const store = storage()
        const nested = { value: 'accepted' }
        const properties: Record<string, unknown> = { nested }
        const item = { message: { ...event('accepted').message, properties } }
        store.set('queue', [item])
        await store.flush()
        if (change === 'cycle') properties.cycle = properties
        else nested.value = 'changed'
        expect(store.get('queue')).toEqual([
            { message: { ...event('accepted').message, properties: { nested: { value: 'accepted' } } } },
        ])
        await store.flush()
        expect((await diskState()).values.queue[0].message.properties).toEqual({ nested: { value: 'accepted' } })
    })

    it('keeps the accepted queue intact when a copy is changed before a rejected set', async () => {
        const store = storage()
        store.set('queue', [event('accepted')])
        await store.flush()
        const next = store.get<ReturnType<typeof event>[]>('queue') ?? []
        next.push({ message: { ...event('invalid').message, properties: { invalid: 1n } } })
        expect(() => store.set('queue', next)).toThrow()
        expect(store.get('queue')).toEqual([event('accepted')])
        await store.flush()
        expect((await diskState()).values.queue.map((item: ReturnType<typeof event>) => item.message.event)).toEqual([
            'accepted',
        ])
    })

    it('does not serialize the store again for unchanged queue reads while still expiring old entries', async () => {
        const store = storage({ maxQueueAgeMs: 100 })
        store.set('queue', [event('accepted')])
        await store.flush()
        const stringify = vi.spyOn(JSON, 'stringify')
        for (let i = 0; i < 20; i++) expect(store.get('queue')).toHaveLength(1)
        expect(stringify).not.toHaveBeenCalled()
        vi.mocked(Date.now).mockReturnValue(NOW + 101)
        expect(store.get('queue')).toEqual([])
        await store.flush()
        expect((await diskState()).values.queue).toEqual([])
    })

    it('loads an absent file without opting out and persists identity and properties across restart', async () => {
        const store = storage()
        await store.load()
        expect(store.get('opted_out')).toBeUndefined()
        store.set('anonymous_id', 'anon')
        store.set('distinct_id', 'identified')
        store.set('props', { plan: 'pro' })
        store.set('opted_out', false)
        expect(store.get('distinct_id')).toBe('identified')
        await store.flush()
        expect(await diskState()).toEqual({
            version: 1,
            values: { anonymous_id: 'anon', distinct_id: 'identified', props: { plan: 'pro' }, opted_out: false },
        })
        const restarted = storage()
        await restarted.load()
        expect(restarted.get('anonymous_id')).toBe('anon')
        expect(restarted.get('props')).toEqual({ plan: 'pro' })
        expect(restarted.get('opted_out')).toBe(false)
    })

    it('removes null values rather than persisting null', async () => {
        const store = storage()
        store.set('distinct_id', 'old')
        store.set('distinct_id', null)
        expect(store.get('distinct_id')).toBeUndefined()
        await store.flush()
        expect((await diskState()).values).toEqual({})
    })

    it('coalesces synchronous changes into one atomic write and leaves no temporary files', async () => {
        const rename = vi.spyOn(fs, 'rename')
        const store = storage()
        store.set('distinct_id', 'first')
        store.set('distinct_id', 'second')
        store.set('props', { a: 1 })
        await store.flush()
        expect(rename).toHaveBeenCalledTimes(1)
        expect((await diskState()).values.distinct_id).toBe('second')
        expect(await fs.readdir(directory)).toEqual(['state.json'])
    })

    it('serializes a newer write arriving during flush and waits for it', async () => {
        const reachedRename = deferred()
        const releaseRename = deferred()
        const rename = fs.rename.bind(fs)
        const spy = vi.spyOn(fs, 'rename').mockImplementationOnce(async (from, to) => {
            reachedRename.resolve()
            await releaseRename.promise
            await rename(from, to)
        })
        const store = storage()
        store.set('distinct_id', 'old')
        const flushing = store.flush()
        await reachedRename.promise
        store.set('distinct_id', 'new')
        releaseRename.resolve()
        await flushing
        expect(spy).toHaveBeenCalledTimes(2)
        expect((await diskState()).values.distinct_id).toBe('new')
        expect(store.get('distinct_id')).toBe('new')
    })

    it('does not lose sets landing as a write worker settles', async () => {
        const unlink = fs.unlink.bind(fs)
        // Exercise both sides of promise settlement without timers or scheduler sleeps.
        for (let depth = 0; depth < 10; depth++) {
            const store = storage()
            const changed = deferred()
            vi.spyOn(fs, 'unlink').mockImplementationOnce(async (path) => {
                await unlink(path).catch(() => {})
                let turn = Promise.resolve()
                for (let i = 0; i < depth; i++) {
                    turn = turn.then(() => {})
                }
                void turn.then(() => {
                    store.set('distinct_id', `new-${depth}`)
                    changed.resolve()
                })
            })
            store.set('distinct_id', 'old')
            const flushing = store.flush()
            await changed.promise
            await flushing
            await store.flush()
            expect((await diskState()).values.distinct_id).toBe(`new-${depth}`)
            vi.mocked(fs.unlink).mockRestore()
        }
    })

    it('keeps the previous complete file visible until rename', async () => {
        const store = storage()
        store.set('distinct_id', 'old')
        await store.flush()
        const reachedRename = deferred()
        const releaseRename = deferred()
        const rename = fs.rename.bind(fs)
        vi.spyOn(fs, 'rename').mockImplementationOnce(async (from, to) => {
            reachedRename.resolve()
            await releaseRename.promise
            await rename(from, to)
        })
        store.set('distinct_id', 'new')
        await reachedRename.promise
        expect((await diskState()).values.distinct_id).toBe('old')
        releaseRename.resolve()
        await store.flush()
        expect((await diskState()).values.distinct_id).toBe('new')
    })

    it('uses restrictive permissions on the directory and state file', async () => {
        if (process.platform === 'win32') {
            return
        }
        await fs.chmod(directory, 0o777)
        const store = storage()
        store.set('distinct_id', 'private')
        await store.flush()
        expect((await fs.stat(directory)).mode & 0o777).toBe(0o700)
        expect((await fs.stat(join(directory, 'state.json'))).mode & 0o777).toBe(0o600)
    })

    it('prunes seven-day-old events using Date and ISO timestamps and preserves the boundary', async () => {
        const store = storage()
        store.set('queue', [
            event('expired', new Date(NOW - 7 * DAY - 1)),
            event('boundary', new Date(NOW - 7 * DAY).toISOString()),
            event('recent'),
        ])
        expect(store.get('queue')).toEqual([event('boundary', new Date(NOW - 7 * DAY).toISOString()), event('recent')])
        await store.flush()
        const restarted = storage()
        await restarted.load()
        expect(restarted.get('queue')).toEqual((await diskState()).values.queue)
    })

    it('applies custom retention on load and flush of an otherwise idle queue', async () => {
        await fs.writeFile(
            join(directory, 'state.json'),
            JSON.stringify({ version: 1, values: { queue: [event('old', new Date(NOW - 101)), event('recent')] } })
        )
        const store = storage({ maxQueueAgeMs: 100 })
        await store.load()
        expect(store.get('queue')).toEqual([event('recent', new Date(NOW).toISOString())])
        vi.mocked(Date.now).mockReturnValue(NOW + 101)
        await store.flush()
        expect((await diskState()).values.queue).toEqual([])
    })

    it('removes oldest timestamps first under a byte cap without reordering survivors', async () => {
        const newest = event('newest', new Date(NOW))
        const middle = event('middle', new Date(NOW - 1))
        const oldest = event('oldest', new Date(NOW - 2))
        const maxStorageBytes = Buffer.byteLength(
            JSON.stringify({ version: 1, values: { distinct_id: 'person', queue: [newest, middle] } })
        )
        const store = storage({ maxStorageBytes })
        store.set('distinct_id', 'person')
        store.set('queue', [newest, oldest, middle])
        expect(store.get('queue')).toEqual([newest, middle])
        await store.flush()
        expect((await fs.stat(join(directory, 'state.json'))).size).toBeLessThanOrEqual(maxStorageBytes)
        expect((await diskState()).values.distinct_id).toBe('person')
    })

    it('enforces the default 5 MiB bound and counts multibyte strings in bytes', async () => {
        const store = storage()
        const large = event('large')
        large.message.properties = { text: '雪'.repeat(2 * 1024 * 1024) }
        store.set('queue', [large, event('small')])
        await store.flush()
        expect((await diskState()).values.queue.map((item: ReturnType<typeof event>) => item.message.event)).toEqual([
            'small',
        ])
        expect((await fs.stat(join(directory, 'state.json'))).size).toBeLessThanOrEqual(5 * 1024 * 1024)
    })

    it('rejects oversized nonqueue state synchronously without changing the previous state', async () => {
        const onError = vi.fn()
        const store = storage({ maxStorageBytes: 100, onError })
        store.set('distinct_id', 'person')
        expect(() => store.set('props', { text: 'x'.repeat(200) })).toThrow(RangeError)
        expect(store.get('props')).toBeUndefined()
        expect(store.get('distinct_id')).toBe('person')
        expect(onError).toHaveBeenCalledTimes(1)
        await store.flush()
        expect((await diskState()).values).toEqual({ distinct_id: 'person' })
    })

    it('does not silently reject an oversized consent change', async () => {
        const maxStorageBytes = Buffer.byteLength(JSON.stringify({ version: 1, values: { props: '1234567890' } }))
        const store = storage({ maxStorageBytes })
        store.set('props', '1234567890')
        expect(() => store.set('opted_out', true)).toThrow(RangeError)
        await store.flush()
        expect(store.get('opted_out')).toBeUndefined()
        expect((await diskState()).values).toEqual({ props: '1234567890' })
    })

    it.each([
        'not json',
        'null',
        '[]',
        '{"version":2,"values":{}}',
        '{"version":1,"values":[]}',
        '{"version":1,"values":{"opted_out":"false"}}',
        '{"version":1,"values":{"queue":[{"message":{"timestamp":"invalid"}}]}}',
    ])('fails closed and clears analytics for corrupt state: %s', async (contents) => {
        await fs.writeFile(join(directory, 'state.json'), contents)
        const onError = vi.fn()
        const store = storage({ onError })
        await expect(store.load()).resolves.toBeUndefined()
        expect(store.get('opted_out')).toBe(true)
        expect(store.get('distinct_id')).toBeUndefined()
        expect(store.get('queue')).toBeUndefined()
        expect(onError).toHaveBeenCalledTimes(1)
        await store.flush()
        expect((await diskState()).values).toEqual({ opted_out: true })
    })

    it('fails closed for unreadable state and tolerates a throwing error handler', async () => {
        // A directory at the file path produces a real read error, even when tests run as root.
        await fs.mkdir(join(directory, 'state.json'))
        const store = storage({
            onError: () => {
                throw new Error('handler failed')
            },
        })
        await expect(store.load()).resolves.toBeUndefined()
        expect(store.get('opted_out')).toBe(true)
        await expect(store.flush()).rejects.toBeDefined()
    })

    it('reports write failures, rejects durability acknowledgments and retries on a later set', async () => {
        await fs.mkdir(join(directory, 'state.json'))
        const onError = vi.fn()
        const store = storage({ onError })
        store.set('distinct_id', 'in-memory')
        await expect(store.flush()).rejects.toBeDefined()
        expect(store.get('distinct_id')).toBe('in-memory')
        expect(onError).toHaveBeenCalledTimes(1)
        await expect(store.flush()).rejects.toBeDefined()
        expect(await fs.readdir(directory)).toEqual(['state.json'])
        await fs.rm(join(directory, 'state.json'), { recursive: true })
        store.set('props', { recovered: true })
        await store.flush()
        expect((await diskState()).values).toEqual({ distinct_id: 'in-memory', props: { recovered: true } })
    })

    it('reports temporary-file write failures and leaves the old file intact', async () => {
        const onError = vi.fn()
        const store = storage({ onError })
        store.set('distinct_id', 'old')
        await store.flush()
        vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'))
        store.set('distinct_id', 'new')
        await expect(store.flush()).rejects.toThrow('disk full')
        expect(onError).toHaveBeenCalledTimes(1)
        expect((await diskState()).values.distinct_id).toBe('old')
        expect(await fs.readdir(directory)).toEqual(['state.json'])
    })

    it('handles a background write failure even when flush was not called at the time', async () => {
        const failed = deferred()
        await fs.mkdir(join(directory, 'state.json'))
        const store = storage({ onError: failed.resolve })
        store.set('opted_out', true)
        await failed.promise
        await expect(store.flush()).rejects.toBeDefined()
        expect(store.get('opted_out')).toBe(true)
    })

    it('keeps the previous disk state intact after a failed rename and cleans its temporary file', async () => {
        const store = storage()
        store.set('distinct_id', 'old')
        await store.flush()
        vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk failure'))
        store.set('distinct_id', 'new')
        await expect(store.flush()).rejects.toThrow('disk failure')
        expect((await diskState()).values.distinct_id).toBe('old')
        expect(await fs.readdir(directory)).toEqual(['state.json'])
    })

    it('does not expose inherited keys or invoke prototype setters on set or load', async () => {
        const store = storage()
        expect(store.get('constructor')).toBeUndefined()
        expect(store.get('__proto__')).toBeUndefined()
        store.set('__proto__', { polluted: true })
        store.set('constructor', 'own constructor')
        store.set('props', JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'))
        await store.flush()
        const restarted = storage()
        await restarted.load()
        expect(restarted.get('__proto__')).toEqual({ polluted: true })
        expect(restarted.get('constructor')).toBe('own constructor')
        expect(Object.prototype).not.toHaveProperty('polluted')
        restarted.set('__proto__', null)
        expect(restarted.get('__proto__')).toBeUndefined()
    })

    it('rejects nonserializable changes without corrupting memory or disk', async () => {
        const store = storage()
        const circular: Record<string, unknown> = {}
        circular.self = circular
        expect(() => store.set('props', circular)).toThrow()
        expect(store.get('props')).toBeUndefined()
        store.set('distinct_id', 'valid')
        await store.flush()
        expect((await diskState()).values).toEqual({ distinct_id: 'valid' })
    })
})
