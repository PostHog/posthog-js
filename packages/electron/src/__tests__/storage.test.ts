import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir, hostname } from 'node:os'
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

    async function storage(options?: ConstructorParameters<typeof ElectronStorage>[1]) {
        const store = new ElectronStorage(directory, options)
        stores.push(store)
        await store.load()
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
        await Promise.all(
            stores.splice(0).map(async (store) => {
                await store.flush().catch(() => {})
                await store.stop()
            })
        )
        vi.restoreAllMocks()
        await fs.rm(directory, { recursive: true, force: true })
    })

    it('loads an absent file without opting out and persists identity and properties across restart', async () => {
        const store = await storage()
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
        await store.stop()
        const restarted = await storage()
        await restarted.load()
        expect(restarted.get('anonymous_id')).toBe('anon')
        expect(restarted.get('props')).toEqual({ plan: 'pro' })
        expect(restarted.get('opted_out')).toBe(false)
    })

    it('releases idle ownership synchronously at final exit without changing persisted state', async () => {
        const store = await storage()
        store.set('distinct_id', 'same-person')
        await store.flush()
        const before = await fs.readFile(join(directory, 'state.json'), 'utf8')
        store.releaseOnExit()
        store.releaseOnExit()
        expect(store.isOwned).toBe(false)
        expect(await fs.readdir(directory)).toEqual(['state.json'])
        expect(await fs.readFile(join(directory, 'state.json'), 'utf8')).toBe(before)
        const next = await storage()
        expect(next.get('distinct_id')).toBe('same-person')
    })

    it('keeps ownership at exit while the initial state read is pending', async () => {
        const reached = deferred(),
            release = deferred()
        const read = fs.readFile.bind(fs)
        vi.spyOn(fs, 'readFile').mockImplementationOnce(async (...args) => {
            reached.resolve()
            await release.promise
            return read(...args)
        })
        const store = new ElectronStorage(directory)
        stores.push(store)
        const loading = store.load()
        await reached.promise
        try {
            store.releaseOnExit()
            expect(store.isOwned).toBe(true)
            expect(await fs.readFile(join(directory, '.owner'), 'utf8')).toContain(String(process.pid))
        } finally {
            release.resolve()
            await loading
        }
    })

    it('keeps ownership at exit while a state write is pending', async () => {
        const store = await storage()
        const reached = deferred(),
            release = deferred()
        const rename = fs.rename.bind(fs)
        vi.spyOn(fs, 'rename').mockImplementationOnce(async (...args) => {
            reached.resolve()
            await release.promise
            await rename(...args)
        })
        store.set('distinct_id', 'pending')
        await reached.promise
        try {
            store.releaseOnExit()
            expect(store.isOwned).toBe(true)
            expect(await fs.readFile(join(directory, '.owner'), 'utf8')).toContain(String(process.pid))
        } finally {
            release.resolve()
            await store.flush()
        }
    })

    it('never mixes final exit release with an async stop already releasing ownership', async () => {
        const store = await storage()
        const reached = deferred(),
            release = deferred()
        const unlink = fs.unlink.bind(fs)
        vi.spyOn(fs, 'unlink').mockImplementationOnce(async (path) => {
            reached.resolve()
            await release.promise
            await unlink(path)
        })
        const stopping = store.stop()
        await reached.promise
        try {
            store.releaseOnExit()
            expect(await fs.readFile(join(directory, '.owner'), 'utf8')).toContain(String(process.pid))
        } finally {
            release.resolve()
            await stopping
        }
        expect(await fs.readdir(directory)).toEqual([])
    })

    it('does not unlink an owner whose nonce changed before final exit', async () => {
        const store = await storage()
        const lock = join(directory, '.owner')
        const replacement = { ...JSON.parse(await fs.readFile(lock, 'utf8')), token: 'b'.repeat(36) }
        await fs.writeFile(lock, JSON.stringify(replacement))
        store.releaseOnExit()
        expect(JSON.parse(await fs.readFile(lock, 'utf8'))).toEqual(replacement)
    })

    it('does not release another live instance ownership at exit', async () => {
        const owner = await storage()
        const lock = await fs.readFile(join(directory, '.owner'), 'utf8')
        const denied = await storage()
        denied.releaseOnExit()
        expect(await fs.readFile(join(directory, '.owner'), 'utf8')).toBe(lock)
        expect(owner.isOwned).toBe(true)
    })

    it('removes null values rather than persisting null', async () => {
        const store = await storage()
        store.set('distinct_id', 'old')
        store.set('distinct_id', null)
        expect(store.get('distinct_id')).toBeUndefined()
        await store.flush()
        expect((await diskState()).values).toEqual({})
    })

    it('coalesces synchronous changes into one atomic write and leaves no temporary files', async () => {
        const rename = vi.spyOn(fs, 'rename')
        const store = await storage()
        store.set('distinct_id', 'first')
        store.set('distinct_id', 'second')
        store.set('props', { a: 1 })
        await store.flush()
        expect(rename).toHaveBeenCalledTimes(1)
        expect((await diskState()).values.distinct_id).toBe('second')
        expect(await fs.readdir(directory)).toEqual(['.owner', 'state.json'])
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
        const store = await storage()
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
            const store = await storage()
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
            await store.stop()
        }
    })

    it('keeps the previous complete file visible until rename', async () => {
        const store = await storage()
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
        const store = await storage()
        store.set('distinct_id', 'private')
        await store.flush()
        expect((await fs.stat(directory)).mode & 0o777).toBe(0o700)
        expect((await fs.stat(join(directory, 'state.json'))).mode & 0o777).toBe(0o600)
    })

    it('prunes seven-day-old events using Date and ISO timestamps and preserves the boundary', async () => {
        const store = await storage()
        store.set('queue', [
            event('expired', new Date(NOW - 7 * DAY - 1)),
            event('boundary', new Date(NOW - 7 * DAY).toISOString()),
            event('recent'),
        ])
        expect(store.get('queue')).toEqual([event('boundary', new Date(NOW - 7 * DAY).toISOString()), event('recent')])
        await store.flush()
        await store.stop()
        const restarted = await storage()
        await restarted.load()
        expect(restarted.get('queue')).toEqual((await diskState()).values.queue)
    })

    it('applies custom retention on load and flush of an otherwise idle queue', async () => {
        await fs.writeFile(
            join(directory, 'state.json'),
            JSON.stringify({ version: 1, values: { queue: [event('old', new Date(NOW - 101)), event('recent')] } })
        )
        const store = await storage({ maxQueueAgeMs: 100 })
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
        const store = await storage({ maxStorageBytes })
        store.set('distinct_id', 'person')
        store.set('queue', [newest, oldest, middle])
        expect(store.get('queue')).toEqual([newest, middle])
        await store.flush()
        expect((await fs.stat(join(directory, 'state.json'))).size).toBeLessThanOrEqual(maxStorageBytes)
        expect((await diskState()).values.distinct_id).toBe('person')
    })

    it('enforces the default 5 MiB bound and counts multibyte strings in bytes', async () => {
        const store = await storage()
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
        const store = await storage({ maxStorageBytes: 100, onError })
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
        const store = await storage({ maxStorageBytes })
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
        const store = await storage({ onError })
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
        const store = await storage({
            onError: () => {
                throw new Error('handler failed')
            },
        })
        await expect(store.load()).resolves.toBeUndefined()
        expect(store.get('opted_out')).toBe(true)
        await expect(store.flush()).rejects.toBeDefined()
    })

    it('reports write failures, rejects durability acknowledgments and retries on a later set', async () => {
        const onError = vi.fn()
        const store = await storage({ onError })
        await fs.mkdir(join(directory, 'state.json'))
        store.set('distinct_id', 'in-memory')
        await expect(store.flush()).rejects.toBeDefined()
        expect(store.get('distinct_id')).toBe('in-memory')
        expect(onError).toHaveBeenCalledTimes(1)
        await expect(store.flush()).rejects.toBeDefined()
        expect(await fs.readdir(directory)).toEqual(['.owner', 'state.json'])
        await fs.rm(join(directory, 'state.json'), { recursive: true })
        store.set('props', { recovered: true })
        await store.flush()
        expect((await diskState()).values).toEqual({ distinct_id: 'in-memory', props: { recovered: true } })
    })

    it('reports temporary-file write failures and leaves the old file intact', async () => {
        const onError = vi.fn()
        const store = await storage({ onError })
        store.set('distinct_id', 'old')
        await store.flush()
        vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk full'))
        store.set('distinct_id', 'new')
        await expect(store.flush()).rejects.toThrow('disk full')
        expect(onError).toHaveBeenCalledTimes(1)
        expect((await diskState()).values.distinct_id).toBe('old')
        expect(await fs.readdir(directory)).toEqual(['.owner', 'state.json'])
    })

    it('handles a background write failure even when flush was not called at the time', async () => {
        const failed = deferred()
        const store = await storage({ onError: failed.resolve })
        await fs.mkdir(join(directory, 'state.json'))
        store.set('opted_out', true)
        await failed.promise
        await expect(store.flush()).rejects.toBeDefined()
        expect(store.get('opted_out')).toBe(true)
    })

    it('keeps the previous disk state intact after a failed rename and cleans its temporary file', async () => {
        const store = await storage()
        store.set('distinct_id', 'old')
        await store.flush()
        vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('disk failure'))
        store.set('distinct_id', 'new')
        await expect(store.flush()).rejects.toThrow('disk failure')
        expect((await diskState()).values.distinct_id).toBe('old')
        expect(await fs.readdir(directory)).toEqual(['.owner', 'state.json'])
    })

    it('does not expose inherited keys or invoke prototype setters on set or load', async () => {
        const store = await storage()
        expect(store.get('constructor')).toBeUndefined()
        expect(store.get('__proto__')).toBeUndefined()
        store.set('__proto__', { polluted: true })
        store.set('constructor', 'own constructor')
        store.set('props', JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'))
        await store.flush()
        await store.stop()
        const restarted = await storage()
        await restarted.load()
        expect(restarted.get('__proto__')).toEqual({ polluted: true })
        expect(restarted.get('constructor')).toBe('own constructor')
        expect(Object.prototype).not.toHaveProperty('polluted')
        restarted.set('__proto__', null)
        expect(restarted.get('__proto__')).toBeUndefined()
    })

    it('rejects nonserializable changes without corrupting memory or disk', async () => {
        const store = await storage()
        const circular: Record<string, unknown> = {}
        circular.self = circular
        expect(() => store.set('props', circular)).toThrow()
        expect(store.get('props')).toBeUndefined()
        store.set('distinct_id', 'valid')
        await store.flush()
        expect((await diskState()).values).toEqual({ distinct_id: 'valid' })
    })
    it('refuses a live owner without reading or changing its analytics, even after attempted writes', async () => {
        const owner = await storage()
        owner.set('distinct_id', 'owner')
        owner.set('queue', [event('owned')])
        await owner.flush()
        const before = await fs.readFile(join(directory, 'state.json'), 'utf8')
        const onError = vi.fn()
        const denied = await storage({ onError })
        expect(denied.isOwned).toBe(false)
        expect(denied.get('opted_out')).toBe(true)
        expect(denied.get('queue')).toBeUndefined()
        denied.set('opted_out', false)
        denied.set('distinct_id', 'intruder')
        await denied.flush()
        await denied.stop()
        expect(onError).toHaveBeenCalledTimes(1)
        expect(await fs.readFile(join(directory, 'state.json'), 'utf8')).toBe(before)
        expect(owner.isOwned).toBe(true)
    })

    it.each([
        'partial json',
        JSON.stringify({ host: 'another-host', pid: 123, token: 'a'.repeat(36) }),
        JSON.stringify({ host: hostname(), pid: -1, token: 'a'.repeat(36) }),
        JSON.stringify({ host: hostname(), pid: 123, token: '../outside' }),
    ])('never steals unverifiable ownership: %s', async (contents) => {
        await fs.writeFile(join(directory, '.owner'), contents)
        const onError = vi.fn()
        const store = await storage({ onError })
        expect(store.isOwned).toBe(false)
        expect(onError).toHaveBeenCalledTimes(1)
        expect(await fs.readFile(join(directory, '.owner'), 'utf8')).toBe(contents)
    })

    it('never steals ownership when the process probe is denied', async () => {
        const contents = JSON.stringify({ host: hostname(), pid: 123, token: 'a'.repeat(36) })
        await fs.writeFile(join(directory, '.owner'), contents)
        vi.spyOn(process, 'kill').mockImplementation(() => {
            throw Object.assign(new Error('denied'), { code: 'EPERM' })
        })
        const store = await storage()
        expect(store.isOwned).toBe(false)
        expect(await fs.readFile(join(directory, '.owner'), 'utf8')).toBe(contents)
    })

    it('fails closed if a dead owner already has a reclamation tombstone', async () => {
        const token = 'a'.repeat(36)
        const contents = JSON.stringify({ host: hostname(), pid: 123, token })
        await fs.writeFile(join(directory, '.owner'), contents)
        await fs.writeFile(join(directory, `.reclaim-${token}`), '')
        vi.spyOn(process, 'kill').mockImplementation(() => {
            throw Object.assign(new Error('dead'), { code: 'ESRCH' })
        })
        const store = await storage()
        expect(store.isOwned).toBe(false)
        expect(await fs.readFile(join(directory, '.owner'), 'utf8')).toBe(contents)
    })

    it('commits an already-started write before releasing ownership on stop', async () => {
        const store = await storage()
        store.set('distinct_id', 'old')
        await store.flush()
        const reachedWrite = deferred(),
            releaseWrite = deferred()
        const write = fs.writeFile.bind(fs)
        vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
            reachedWrite.resolve()
            await releaseWrite.promise
            await write(...args)
        })
        store.set('distinct_id', 'new')
        await reachedWrite.promise
        const rename = fs.rename.bind(fs)
        const committed = vi.spyOn(fs, 'rename').mockImplementationOnce(async (...args) => {
            expect(await fs.readFile(join(directory, '.owner'), 'utf8')).toContain(String(process.pid))
            await rename(...args)
        })
        const stopping = store.stop()
        expect(await fs.readFile(join(directory, '.owner'), 'utf8')).toContain(String(process.pid))
        releaseWrite.resolve()
        await stopping
        expect(committed).toHaveBeenCalledOnce()
        expect((await diskState()).values.distinct_id).toBe('new')
        expect(await fs.readdir(directory)).toEqual(['state.json'])
    })
})
