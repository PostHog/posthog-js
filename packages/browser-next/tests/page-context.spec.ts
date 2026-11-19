import { createPostHog } from '../src/composition/npm/core'
import type { CorePostHogOptions, IPostHog } from '../src/core/types'
import { recordCapture, recordedEvents, recordingOptions, type RecordedRequest } from './capture-recorder'

describe('page context', () => {
    let requests: RecordedRequest[]
    let posthog: IPostHog | undefined

    const create = async (options: Partial<CorePostHogOptions> = {}): Promise<IPostHog> => {
        posthog = await createPostHog({ ...recordingOptions(recordCapture(requests)), ...options })
        return posthog
    }

    const sent = async (client: IPostHog): Promise<Array<Record<string, unknown>>> => {
        await client.flush()
        return recordedEvents(requests).map((event) => event.properties)
    }

    beforeEach(() => {
        requests = []
        vi.stubGlobal('location', new URL('https://user:secret@example.com/products/42?token=abc#section'))
        vi.stubGlobal('document', { title: 'Product 42' })
        vi.stubGlobal('window', globalThis)
    })

    afterEach(async () => {
        await posthog?.shutdown()
        posthog = undefined
        vi.unstubAllGlobals()
    })

    it('adds the page URL, host and path to every event', async () => {
        const client = await create()
        client.capture('custom')

        const [custom] = await sent(client)
        expect(custom).toMatchObject({
            $current_url: 'https://example.com/products/42?token=abc#section',
            $host: 'example.com',
            $pathname: '/products/42',
        })
        expect(custom).not.toHaveProperty('title')
    })

    it('adds the document title to pageviews', async () => {
        const client = await create()
        client.capture('$pageview')

        const [pageview] = await sent(client)
        expect(pageview).toMatchObject({
            $current_url: 'https://example.com/products/42?token=abc#section',
            title: 'Product 42',
        })
    })

    it('reads the page at capture time', async () => {
        const client = await create()
        client.capture('first')
        vi.stubGlobal('location', new URL('https://example.com/checkout'))
        client.capture('second')

        const [first, second] = await sent(client)
        expect(first?.$pathname).toBe('/products/42')
        expect(second?.$pathname).toBe('/checkout')
    })

    it('lets registered and caller values replace page context for that event only', async () => {
        const client = await create()
        client.register({ $host: 'registered.example' })
        client.capture('$pageview', { $current_url: 'https://caller.example/', title: 'Caller', $pathname: null })
        client.unregister('$host')
        client.capture('$pageview')

        const [overridden, next] = await sent(client)
        expect(overridden).toMatchObject({
            $current_url: 'https://caller.example/',
            $host: 'registered.example',
            title: 'Caller',
        })
        expect(overridden).not.toHaveProperty('$pathname')
        expect(next).toMatchObject({
            $current_url: 'https://example.com/products/42?token=abc#section',
            $host: 'example.com',
            $pathname: '/products/42',
            title: 'Product 42',
        })
    })

    it('drops the query and fragment when disabled', async () => {
        const client = await create({ urlSanitization: { query: false, hash: false } })
        client.capture('custom')

        const [custom] = await sent(client)
        expect(custom?.$current_url).toBe('https://example.com/products/42')
    })

    it('replaces the path with / when path capture is disabled', async () => {
        const client = await create({ urlSanitization: { path: false } })
        client.capture('custom')

        const [custom] = await sent(client)
        expect(custom).toMatchObject({ $current_url: 'https://example.com/?token=abc#section', $pathname: '/' })
    })

    it('rewrites the URL before filtering its parts', async () => {
        const received: string[] = []
        const sanitize = (url: URL) => {
            received.push(url.href)
            url.host = 'app.example.com'
            url.pathname = url.pathname.replace(/\/\d+$/, '/:id')
            url.searchParams.set('added', '1')
            return url.toString()
        }
        const client = await create({ urlSanitization: { sanitize, query: false } })
        client.capture('custom')

        const [custom] = await sent(client)
        expect(received).toEqual(['https://user:secret@example.com/products/42?token=abc#section'])
        expect(custom).toMatchObject({
            $current_url: 'https://app.example.com/products/:id#section',
            $host: 'app.example.com',
            $pathname: '/products/:id',
        })
        expect(String(globalThis.location)).toBe('https://user:secret@example.com/products/42?token=abc#section')
    })

    it.each([
        [
            'throws',
            () => {
                throw new Error('sanitize failed')
            },
        ],
        ['returns a relative URL', () => '/relative'],
        ['returns a non-URL value', () => 42 as unknown as string],
        ['returns a promise', () => Promise.resolve('https://example.com/') as unknown as string],
    ])('omits the page URL when sanitize %s, but still sends the event', async (_case, sanitize) => {
        const client = await create({ urlSanitization: { sanitize } })
        expect(client.capture('$pageview')).toBe(true)

        const [pageview] = await sent(client)
        expect(pageview).toBeDefined()
        expect(pageview).not.toHaveProperty('$current_url')
        expect(pageview).not.toHaveProperty('$host')
        expect(pageview).not.toHaveProperty('$pathname')
        expect(pageview?.title).toBe('Product 42')
    })

    it('adds no page context without a location or document', async () => {
        vi.stubGlobal('location', undefined)
        vi.stubGlobal('document', undefined)
        const client = await create()
        client.capture('$pageview')

        const [pageview] = await sent(client)
        expect(pageview).toBeDefined()
        for (const key of ['$current_url', '$host', '$pathname', 'title']) expect(pageview).not.toHaveProperty(key)
    })

    it('accepts a URL object from sanitize', async () => {
        const sanitize = (url: URL) => {
            url.searchParams.delete('token')
            return url
        }
        const client = await create({ urlSanitization: { sanitize } })
        client.capture('custom')

        const [custom] = await sent(client)
        expect(custom?.$current_url).toBe('https://example.com/products/42#section')
    })

    it('omits an opaque URL when path capture is disabled', async () => {
        vi.stubGlobal('location', new URL('about:srcdoc'))
        const client = await create({ urlSanitization: { path: false } })
        client.capture('custom')

        const [custom] = await sent(client)
        expect(custom).toBeDefined()
        expect(custom).not.toHaveProperty('$current_url')
    })

    it('captures the event when reading the document title throws', async () => {
        vi.stubGlobal('document', {
            get title(): string {
                throw new Error('title unavailable')
            },
        })
        const client = await create()

        expect(client.capture('$pageview')).toBe(true)
        const [pageview] = await sent(client)
        expect(pageview).toBeDefined()
        expect(pageview).not.toHaveProperty('title')
    })

    it('adds no page URL in a worker, where location is the script URL', async () => {
        vi.stubGlobal('window', undefined)
        const client = await create()
        client.capture('custom')

        const [custom] = await sent(client)
        expect(custom).not.toHaveProperty('$current_url')
    })
})
