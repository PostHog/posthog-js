import { createPostHog } from '../src/index'
import { createPostHog as createCore } from '../src/core'
import type { IPostHog } from '../src/types'
import type { Survey } from '../src/surveys-options'
import { SURVEYS } from '@posthog/browser-common/surveys-config'
import { localRemoteConfig, MemoryStorage } from './helpers'

const clients: IPostHog[] = []
const base = {
    projectToken: 'ph_preset',
    storage: false,
    navigator: false,
    fetch: false,
    capturePageview: false,
    analytics: false,
    flags: false,
    autocapture: false,
    remoteConfig: localRemoteConfig,
} as const
const definition: Survey = {
    id: 'available',
    name: 'Feedback',
    type: 'popover',
    questions: [{ type: 'open', question: 'How was it?' }],
    feature_flag_keys: null,
    linked_flag_key: null,
    targeting_flag_key: null,
    internal_targeting_flag_key: null,
    appearance: null,
    conditions: null,
    start_date: null,
    end_date: null,
    current_iteration: null,
    current_iteration_start_date: null,
}
afterEach(async () => {
    for (const client of clients.splice(0)) await client.dispose()
    vi.restoreAllMocks()
})

describe('root product composition', () => {
    it('isolates option getter failures and reports them after setup in reverse configuration order', async () => {
        const log = vi.spyOn(console, 'error').mockImplementation(() => {})
        const errors = {
            flags: new Error('flags'),
            logs: new Error('logs'),
            surveys: new Error('surveys'),
            autocapture: new Error('autocapture'),
        }
        const client = await createPostHog({
            ...base,
            debug: true,
            get flags(): never {
                throw errors.flags
            },
            get logs(): never {
                throw errors.logs
            },
            get surveys(): never {
                throw errors.surveys
            },
            get autocapture(): never {
                throw errors.autocapture
            },
        })
        clients.push(client)
        expect(log.mock.calls).toEqual(
            ['autocapture', 'surveys', 'logs', 'flags'].map((name) => [
                '[PostHog]',
                `Automatic ${name} loading failed`,
                errors[name as keyof typeof errors],
            ])
        )
        expect(client.canCapture).toBe(true)
        expect(client.featureFlags).toBeUndefined()
        expect(client.logs).toBeUndefined()
        expect(client.surveys).toBeUndefined()
        expect(client.autocapture).toBeUndefined()
    })

    it('does not read automatic options for explicitly supplied products', async () => {
        const flags = { name: 'featureFlags', setup: vi.fn() }
        const logs = { name: 'logs', setup: vi.fn() }
        const surveys = { name: 'surveys', setup: vi.fn() }
        const autocapture = { name: 'autocapture', setup: vi.fn() }
        const read = vi.fn((): never => {
            throw new Error('automatic options are unavailable')
        })
        const client = await createPostHog({
            ...base,
            extensions: [flags, logs, surveys, autocapture],
            get flags() {
                return read()
            },
            get logs() {
                return read()
            },
            get surveys() {
                return read()
            },
            get autocapture() {
                return read()
            },
        })
        clients.push(client)
        expect(read).not.toHaveBeenCalled()
        expect(client.featureFlags).toBe(flags)
        expect(client.logs).toBe(logs)
        expect(client.surveys).toBe(surveys)
        expect(client.autocapture).toBe(autocapture)
        for (const product of [flags, logs, surveys, autocapture]) expect(product.setup).toHaveBeenCalledOnce()
    })

    it.each([undefined, [], [definition]])(
        'activates surveys only for a nonempty remote list (%j)',
        async (surveys) => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => {})
            const client = await createPostHog({
                ...base,
                debug: true,
                remoteConfig: surveys === undefined ? localRemoteConfig : { ...localRemoteConfig, surveys },
            })
            clients.push(client)
            expect(!!client.surveys).toBe(!!surveys?.length)
            expect(client.logs).toBeUndefined()
            expect(error).not.toHaveBeenCalled()
        }
    )

    it('does not activate surveys from an empty persisted list', async () => {
        const storage = new MemoryStorage()
        const writer = await createCore({
            ...base,
            storage,
            extensions: [
                {
                    name: 'surveys',
                    setup(host) {
                        host.kv.set(SURVEYS, [])
                    },
                },
            ],
        })
        await writer.dispose()
        const client = await createPostHog({ ...base, storage })
        clients.push(client)
        expect(client.surveys).toBeUndefined()
        expect(client.logs).toBeUndefined()
    })
})
