import { FlagsPersistence } from '../src/flags-persistence'
import { createPostHog } from '../src/core'
import { MemoryStorage } from './helpers'
import { ENABLED_FEATURE_FLAGS, PERSISTENCE_ACTIVE_FEATURE_FLAGS } from '@posthog/browser-common/constants'
import type { PostHog } from '../src/types'

const clients: PostHog[] = []
const records: FlagsPersistence[] = []
const setup = async (storage = new MemoryStorage()) => {
    const client = await createPostHog({
        projectToken: 'test',
        storage,
        navigator: false,
        fetch: false,
        capturePageview: false,
    })
    clients.push(client)
    const record = new FlagsPersistence({ storage, key: 'product_flags', observeNativeStorage: false }, client)
    records.push(record)
    return { client, record, storage }
}
afterEach(async () => {
    records.splice(0).forEach((record) => record.dispose())
    await Promise.all(clients.splice(0).map((client) => client.dispose()))
})

describe('FlagsPersistence', () => {
    it('merges partial snapshots using explicitly owned flag keys, including removals', async () => {
        const { record: first, storage } = await setup()
        const { record: second } = await setup(storage)
        first.kv.set({ [ENABLED_FEATURE_FLAGS]: { a: true }, [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['a'] })
        const stale = second.kv.get<Record<string, boolean>>(ENABLED_FEATURE_FLAGS)
        first.kv.set({ [ENABLED_FEATURE_FLAGS]: { a: true, b: true }, [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['a', 'b'] })
        second.markCrossTabFeatureFlagChanges({
            [ENABLED_FEATURE_FLAGS]: ['a'],
            [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: ['a'],
        })
        second.kv.set({ [ENABLED_FEATURE_FLAGS]: { ...stale, a: false }, [PERSISTENCE_ACTIVE_FEATURE_FLAGS]: [] })
        expect(first.kv.get(ENABLED_FEATURE_FLAGS)).toEqual({ a: false, b: true })
        expect(first.kv.get(PERSISTENCE_ACTIVE_FEATURE_FLAGS)).toEqual(['b'])
        second.markCrossTabFeatureFlagChanges({ [ENABLED_FEATURE_FLAGS]: true })
        second.kv.set(ENABLED_FEATURE_FLAGS, { complete: true })
        expect(first.kv.get(ENABLED_FEATURE_FLAGS)).toEqual({ complete: true })
    })

    it("merges ordinary map updates without resurrecting another tab's removed properties", async () => {
        const { record: first, storage } = await setup()
        const { record: second } = await setup(storage)
        first.kv.set('properties', { old: 1 })
        const stale = second.kv.get<Record<string, unknown>>('properties')
        first.kv.set('properties', { fresh: 2 })
        second.kv.set('properties', { ...stale, mine: 3 })
        expect(first.kv.get('properties')).toEqual({ fresh: 2, mine: 3 })
    })

    it('subscribes through the selected custom adapter and cleans up once', async () => {
        let notify: (() => void) | undefined
        const dispose = vi.fn()
        const storage = Object.assign(new MemoryStorage(), {
            subscribe: vi.fn((_key: string, listener: () => void) => {
                notify = listener
                return { dispose }
            }),
        })
        const { record, client } = await setup(storage)
        const callback = vi.fn()
        record.onCrossTabFeatureFlagChange(callback)
        storage.setItem('product_flags', JSON.stringify({ distinctId: client.distinctId, values: { test: 1 } }))
        notify?.()
        expect(callback).not.toHaveBeenCalled()
        expect(record.kv.get('test')).toBe(1)
        storage.setItem(
            'product_flags',
            JSON.stringify({
                distinctId: client.distinctId,
                values: { [ENABLED_FEATURE_FLAGS]: { test: true } },
            })
        )
        notify?.()
        expect(callback).toHaveBeenCalledTimes(1)
        expect(record.kv.get(ENABLED_FEATURE_FLAGS)).toEqual({ test: true })
        record.dispose()
        record.dispose()
        expect(dispose).toHaveBeenCalledTimes(1)
    })

    it('retains memory state when storage writes fail', async () => {
        const { record, storage } = await setup()
        record.kv.set('test', 1)
        storage.setItem = () => {
            throw new Error('blocked')
        }
        record.kv.set('test', 2)
        expect(record.kv.get('test')).toBe(2)
    })

    it('falls back to memory when storage reads or subscriptions fail', async () => {
        const storage = Object.assign(new MemoryStorage(), {
            subscribe() {
                throw new Error('subscribe')
            },
        })
        const { record } = await setup(storage)
        storage.getItem = () => {
            throw new Error('read')
        }
        record.kv.set('test', 2)
        expect(record.kv.get('test')).toBe(2)
    })
})
