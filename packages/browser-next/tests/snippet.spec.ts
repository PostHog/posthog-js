import { createPostHog } from '../src/composition/npm/index'
import { createPostHog as createCorePostHog } from '../src/composition/npm/core'
import { parseSnippetOptions, startSnippet, type ScriptPostHog } from '../src/composition/script/runtime'
import type { IPostHog } from '../src/core/types'

vi.mock('../src/composition/npm/index', () => ({ createPostHog: vi.fn() }))
const create = vi.mocked(createPostHog)
const url = 'https://cdn.example/nested/script.js?projectToken=phc_fixture'
const target = () => new EventTarget() as unknown as Window & { posthog?: unknown }
const client = () => ({ dispose: vi.fn(async () => {}) }) as unknown as IPostHog

afterEach(() => {
    vi.restoreAllMocks()
})

describe('snippet query configuration', () => {
    it('keeps SDK defaults and ignores unknown parameters', () => {
        expect(parseSnippetOptions(url + '&unknown=true')).toEqual({ projectToken: 'phc_fixture' })
    })

    it('accepts an explicit proxy base and the documented primitive options', () => {
        expect(
            parseSnippetOptions(
                url +
                    '&apiHost=https%3A%2F%2Fproxy.example%2Fph&capturePageview=false&optOutByDefault=true&debug=true&disableBotDetection=false&storage=false&flags=false&logs=false&surveys=false&autocapture=false'
            )
        ).toEqual({
            projectToken: 'phc_fixture',
            apiHost: 'https://proxy.example/ph',
            capturePageview: false,
            optOutByDefault: true,
            debug: true,
            disableBotDetection: false,
            storage: false,
            flags: false,
            logs: false,
            surveys: false,
            autocapture: false,
        })
    })

    it.each([
        'https://cdn.example/script.js',
        'https://cdn.example/script.js?projectToken=%20',
        url + '&apiHost=javascript:bad',
        url + '&apiHost=https://user:password@proxy.example',
        url + '&apiHost=https://proxy.example?token=bad',
        url + '&capturePageview=1',
        url + '&storage=true',
        url + '&flags=true',
    ])('rejects invalid configuration', (input) => {
        expect(() => parseSnippetOptions(input)).toThrow()
    })
})

describe('snippet installation', () => {
    it('exposes the group and person functions as methods on the global client', async () => {
        const bodies: string[] = []
        const real = await createCorePostHog({
            projectToken: 'phc_fixture',
            capturePageview: false,
            storage: false,
            navigator: false,
            analytics: { flushAt: 100, flushInterval: 0 },
            fetch: async (input, init) => {
                if (String(input).includes('/i/v1/analytics/events')) bodies.push(String(init?.body))
                return new Response('{}', { status: 200 })
            },
        })
        create.mockResolvedValueOnce(real)
        const installed = target()
        await startSnippet(url, installed)
        const posthog = installed.posthog as ScriptPostHog
        posthog.identify('user-1')
        posthog.group('company', 'acme')
        posthog.alias('alias-1')
        posthog.setPersonProperties({ plan: 'pro' })
        posthog.capture('after_group')
        await posthog.flush()
        const events = bodies.flatMap(
            (body) =>
                (JSON.parse(body) as { batch?: Array<{ event: string; properties: Record<string, unknown> }> }).batch ??
                []
        )
        expect(events.find((event) => event.event === 'after_group')?.properties.$groups).toEqual({ company: 'acme' })
        expect(events.map((event) => event.event)).toEqual(
            expect.arrayContaining(['$groupidentify', '$create_alias', '$set'])
        )
        expect(Object.keys(posthog)).not.toContain('group')
        await posthog.shutdown()
    })

    it('creates the client from the parsed script options', async () => {
        create.mockResolvedValueOnce(client())
        await startSnippet(url + '&flags=false', target())
        expect(create).toHaveBeenCalledWith({ projectToken: 'phc_fixture', flags: false })
    })

    it('publishes only after factory readiness, with one winner across concurrent tags', async () => {
        let resolve!: (value: IPostHog) => void
        create.mockImplementationOnce(
            () =>
                new Promise((done) => {
                    resolve = done
                })
        )
        const window = target()
        const ready = vi.fn((event: Event) => {
            expect((event as CustomEvent).detail).toBe(window.posthog)
        })
        // oxlint-disable-next-line posthog-js/no-add-event-listener
        window.addEventListener('posthog:ready', ready)
        const pending = startSnippet(url, window)
        await startSnippet(url + '_second', window)
        expect(create).toHaveBeenCalledOnce()
        expect(window.posthog).toBeUndefined()
        expect(ready).not.toHaveBeenCalled()
        const value = client()
        resolve(value)
        await pending
        expect(window.posthog).toBe(value)
        expect(ready).toHaveBeenCalledOnce()
        await startSnippet(url, window)
        expect(create).toHaveBeenCalledOnce()
    })

    it('does not touch an occupied global, including a reserved undefined property', async () => {
        const window = target()
        window.posthog = undefined
        await startSnippet(url, window)
        expect(create).not.toHaveBeenCalled()
    })

    it('disposes its unpublished client if another installer wins during initialization', async () => {
        const window = target()
        const legacy = {}
        const value = client()
        create.mockImplementationOnce(async () => {
            window.posthog = legacy
            return value
        })
        const ready = vi.fn()
        // oxlint-disable-next-line posthog-js/no-add-event-listener
        window.addEventListener('posthog:ready', ready)
        await startSnippet(url, window)
        expect(window.posthog).toBe(legacy)
        expect(value.dispose).toHaveBeenCalledOnce()
        expect(ready).not.toHaveBeenCalled()
    })

    it('contains diagnostic failures when initialization cannot complete', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {
            throw new Error('console unavailable')
        })
        await expect(startSnippet('https://cdn.example/script.js', target())).resolves.toBeUndefined()
    })

    it('contains initialization failure, redacts errors, and permits a subsequent tag to retry', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        create.mockRejectedValueOnce(new Error('secret token in original error'))
        const window = target()
        await expect(startSnippet(url, window)).resolves.toBeUndefined()
        expect(error).toHaveBeenCalledWith('PostHog script', 'initialization failed')
        const value = client()
        create.mockResolvedValueOnce(value)
        await startSnippet(url, window)
        expect(window.posthog).toBe(value)
    })
})
