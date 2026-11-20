import type { Disposable } from '@posthog/browser-common'
import type { IPostHog, StorageLike } from '../src/core/types'
import { CONSENT_KEY, createClient, MemoryStorage, type SentEvent } from './identity-fixtures'

/** Notifies subscribers of every write, as an adapter does for changes made by another context. */
class SubscribableStorage extends MemoryStorage {
    private readonly _listeners = new Map<string, Set<() => void>>()
    override setItem(key: string, value: string): void {
        super.setItem(key, value)
        this._listeners.get(key)?.forEach((listener) => listener())
    }
    override removeItem(key: string): void {
        super.removeItem(key)
        this._listeners.get(key)?.forEach((listener) => listener())
    }
    subscribe(key: string, listener: () => void): Disposable {
        const listeners = this._listeners.get(key) ?? new Set()
        this._listeners.set(key, listeners)
        listeners.add(listener)
        return { dispose: () => listeners.delete(listener) }
    }
}

describe('explicit consent status', () => {
    const clients: IPostHog[] = []
    const create = async (...args: Parameters<typeof createClient>): Promise<IPostHog> => {
        const client = await createClient(...args)
        clients.push(client)
        return client
    }

    afterEach(async () => {
        await Promise.all(clients.splice(0).map((client) => client.shutdown()))
    })

    it('is pending until the user chooses', async () => {
        const posthog = await create(new MemoryStorage())
        expect(posthog.getExplicitConsentStatus()).toBe('pending')
        posthog.optIn()
        expect(posthog.getExplicitConsentStatus()).toBe('granted')
        posthog.optOut()
        expect(posthog.getExplicitConsentStatus()).toBe('denied')
    })

    it('stays pending when capture is opted out by default', async () => {
        const posthog = await create(new MemoryStorage(), [], { optOutByDefault: true })
        expect(posthog.hasOptedOut()).toBe(true)
        expect(posthog.getExplicitConsentStatus()).toBe('pending')
    })

    it.each([
        ['1', 'granted'],
        ['yes', 'granted'],
        ['0', 'denied'],
        ['false', 'denied'],
        ['maybe', 'pending'],
    ] as const)('reads a stored %s choice as %s', async (stored, status) => {
        const storage = new MemoryStorage()
        storage.setItem(CONSENT_KEY, stored)
        const posthog = await create(storage)
        expect(posthog.getExplicitConsentStatus()).toBe(status)
    })

    it('reflects a choice another context stores', async () => {
        const storage = new MemoryStorage()
        const posthog = await create(storage)
        storage.setItem(CONSENT_KEY, '0')
        expect(posthog.getExplicitConsentStatus()).toBe('denied')
    })

    it.each([
        ['optIn', null, 'granted:granted'],
        ['optOut', null, 'denied:denied'],
        ['clearOptInOut', '0', 'implicit:pending'],
    ] as const)('reports the new choice to consent listeners after %s', async (method, stored, change) => {
        const storage = new MemoryStorage()
        if (stored !== null) storage.setItem(CONSENT_KEY, stored)
        const posthog = await create(storage)
        const changes: string[] = []
        posthog.onConsentChange(({ current }) => {
            // Records the status before a nested notification can append another change.
            const index = changes.push(current) - 1
            changes[index] = `${current}:${posthog.getExplicitConsentStatus()}`
        })
        posthog[method]()
        expect(changes).toEqual([change])
    })

    it('keeps choices in memory without storage', async () => {
        const posthog = await create(false)
        posthog.optOut()
        expect(posthog.getExplicitConsentStatus()).toBe('denied')
        posthog.clearOptInOut()
        expect(posthog.getExplicitConsentStatus()).toBe('pending')
    })
})

describe('clearing the consent choice', () => {
    const clients: IPostHog[] = []
    const create = async (...args: Parameters<typeof createClient>): Promise<IPostHog> => {
        const client = await createClient(...args)
        clients.push(client)
        return client
    }

    afterEach(async () => {
        await Promise.all(clients.splice(0).map((client) => client.shutdown()))
    })

    it('removes the stored choice and resumes capture by default', async () => {
        const storage = new MemoryStorage()
        const sent: SentEvent[] = []
        const posthog = await create(storage, sent)
        posthog.optOut()
        posthog.clearOptInOut()
        expect(storage.getItem(CONSENT_KEY)).toBeNull()
        expect(posthog.getExplicitConsentStatus()).toBe('pending')
        expect(posthog.hasOptedOut()).toBe(false)
        posthog.capture('after_clear')
        await posthog.flush()
        expect(sent.map((event) => event.event)).toEqual(['after_clear'])
    })

    it('returns to opted out when capture is opted out by default and delivers events queued before it', async () => {
        const sent: SentEvent[] = []
        const posthog = await create(new MemoryStorage(), sent, { optOutByDefault: true })
        posthog.optIn()
        posthog.capture('queued_before_clear')
        posthog.clearOptInOut()
        expect(posthog.hasOptedOut()).toBe(true)
        posthog.capture('after_clear')
        await posthog.flush()
        expect(sent.map((event) => event.event)).toEqual(['queued_before_clear'])
    })

    it('publishes the consent transition', async () => {
        const posthog = await create(new MemoryStorage())
        const changes: unknown[] = []
        posthog.onConsentChange((change) => changes.push(change))
        posthog.optOut()
        posthog.clearOptInOut()
        posthog.clearOptInOut()
        expect(changes).toEqual([
            { current: 'denied', previous: 'implicit' },
            { current: 'implicit', previous: 'denied' },
        ])
    })

    it('reaches clients observing the same storage', async () => {
        const storage = new SubscribableStorage()
        const writer = await create(storage)
        const observer = await create(storage)
        const changes: unknown[] = []
        observer.onConsentChange((change) => changes.push(change))
        writer.optOut()
        writer.clearOptInOut()
        expect(observer.getExplicitConsentStatus()).toBe('pending')
        expect(changes).toEqual([
            { current: 'denied', previous: 'implicit' },
            { current: 'implicit', previous: 'denied' },
        ])
    })

    it('keeps events another client queued with consent when this client resets', async () => {
        const storage = new SubscribableStorage()
        const resetting = await create(storage, [], { optOutByDefault: true })
        const sent: SentEvent[] = []
        const observer = await create(storage, sent, { optOutByDefault: true })
        resetting.optIn()
        observer.capture('queued_before_reset')
        resetting.reset()
        observer.capture('after_reset')
        await observer.flush()
        expect(sent.map((event) => event.event)).toEqual(['queued_before_reset'])
    })

    it('keeps the cleared choice in memory when storage removal fails', async () => {
        const storage = new MemoryStorage()
        storage.setItem(CONSENT_KEY, '0')
        const failing: StorageLike = {
            getItem: (key) => storage.getItem(key),
            setItem: (key, value) => storage.setItem(key, value),
            removeItem: () => {
                throw new Error('blocked')
            },
        }
        const posthog = await create(failing)
        posthog.clearOptInOut()
        expect(storage.getItem(CONSENT_KEY)).toBe('0')
        expect(posthog.getExplicitConsentStatus()).toBe('pending')
        expect(posthog.hasOptedOut()).toBe(false)
    })
})
