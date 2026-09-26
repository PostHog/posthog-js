import * as React from 'react'
import { render } from '@testing-library/react'
import { PostHogProvider, PostHog, PostHogContext } from '..'
import posthogJs from 'posthog-js'
import { setDefaultPostHogInstance } from '../posthog-default'

vi.mock('posthog-js', () => ({
    __esModule: true,
    default: {
        init: vi.fn(),
        __loaded: false,
    },
}))

describe('PostHogContext component', () => {
    const posthog = {} as unknown as PostHog

    beforeEach(() => {
        setDefaultPostHogInstance(posthogJs)
    })

    afterEach(() => {
        setDefaultPostHogInstance(undefined)
        vi.restoreAllMocks()
    })

    it('should return a client instance from the context if available', () => {
        function ClientConsumer() {
            const { client } = React.useContext(PostHogContext)
            return <div data-testid="client">{client === posthog ? 'match' : 'mismatch'}</div>
        }
        const { getByTestId } = render(
            <PostHogProvider client={posthog}>
                <ClientConsumer />
            </PostHogProvider>
        )
        expect(getByTestId('client').textContent).toBe('match')
    })

    it('uses the default client when no client or API key is supplied', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        let observedClient: unknown
        function DefaultConsumer() {
            observedClient = React.useContext(PostHogContext).client
            return <div>Hello</div>
        }

        expect(() => {
            render(
                <PostHogProvider client={undefined as any}>
                    <DefaultConsumer />
                </PostHogProvider>
            )
        }).not.toThrow()
        expect(observedClient).toBe(posthogJs)

        // oxlint-disable-next-line no-console
        expect(console.warn).toHaveBeenCalledWith(
            '[PostHog.js] No `apiKey` or `client` were provided to `PostHogProvider`. Using default global `window.posthog` instance. You must initialize it manually. This is not recommended behavior.'
        )
    })
})

describe('PostHogContext across entrypoints', () => {
    afterEach(() => {
        vi.doUnmock('react')
        vi.resetModules()
        setDefaultPostHogInstance(undefined)
    })

    it('shares one context and default client between separately loaded module copies', async () => {
        vi.resetModules()
        const first = await vi.importActual<typeof import('../PostHogContext')>('../PostHogContext')
        const firstDefault = await vi.importActual<typeof import('../posthog-default')>('../posthog-default')
        vi.resetModules()
        const second = await vi.importActual<typeof import('../PostHogContext')>('../PostHogContext')

        expect(second.PostHogContext).toBe(first.PostHogContext)

        const client = {} as unknown as PostHog
        firstDefault.setDefaultPostHogInstance(client)
        function ClientConsumer() {
            const { client: contextClient } = React.useContext(second.PostHogContext)
            return <div data-testid="client">{contextClient === client ? 'match' : 'mismatch'}</div>
        }
        const { getByTestId } = render(<ClientConsumer />)
        expect(getByTestId('client').textContent).toBe('match')
        firstDefault.setDefaultPostHogInstance(undefined)
    })

    it('keeps each module copy on its own default client', async () => {
        vi.resetModules()
        const first = await vi.importActual<typeof import('../posthog-default')>('../posthog-default')
        vi.resetModules()
        const second = await vi.importActual<typeof import('../posthog-default')>('../posthog-default')
        const firstClient = {} as unknown as PostHog
        const secondClient = {} as unknown as PostHog

        first.setDefaultPostHogInstance(firstClient)
        second.setDefaultPostHogInstance(secondClient)

        expect(first.getDefaultPostHogInstance()).toBe(firstClient)
        expect(second.getDefaultPostHogInstance()).toBe(secondClient)
        first.setDefaultPostHogInstance(undefined)
        second.setDefaultPostHogInstance(undefined)
    })

    it('keeps a separate context and default client for a different copy of React', async () => {
        vi.resetModules()
        const first = await vi.importActual<typeof import('../PostHogContext')>('../PostHogContext')
        const firstDefault = await vi.importActual<typeof import('../posthog-default')>('../posthog-default')
        vi.resetModules()
        vi.doMock('react', async () => {
            const actual = await vi.importActual<typeof import('react')>('react')
            return {
                ...actual,
                createContext: (...args: Parameters<typeof actual.createContext>) => actual.createContext(...args),
            }
        })
        const second = await vi.importActual<typeof import('../PostHogContext')>('../PostHogContext')
        const secondDefault = await vi.importActual<typeof import('../posthog-default')>('../posthog-default')

        expect(second.PostHogContext).not.toBe(first.PostHogContext)
        firstDefault.setDefaultPostHogInstance({} as unknown as PostHog)
        expect(secondDefault.getDefaultPostHogInstance()).toBeUndefined()
        firstDefault.setDefaultPostHogInstance(undefined)
    })
})
