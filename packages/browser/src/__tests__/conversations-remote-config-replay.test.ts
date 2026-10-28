import { createPosthogInstance } from './helpers/posthog-instance'
import { assignableWindow } from '../utils/globals'
import type { PostHog } from '../posthog-core'
import type { PostHogConfig, RemoteConfig } from '../types'

// Conversations' remote config is cleared by reset() and no new remote-config request follows,
// so core must replay the cached result. See https://github.com/PostHog/posthog-js/issues/5382
describe('conversations remote config after reset and opt-in', () => {
    const conversationsRemoteConfig = {
        conversations: { enabled: true, token: 'conversations-token', widgetEnabled: true },
    } as unknown as Partial<RemoteConfig>

    let createdManagers: Array<{ reset: ReturnType<typeof vi.fn> }>
    let initConversations: ReturnType<typeof vi.fn>
    const instances: PostHog[] = []

    const setup = async (config: Partial<PostHogConfig> = {}) => {
        const posthog = await createPosthogInstance(
            undefined,
            { disable_conversations: false, ...config },
            conversationsRemoteConfig
        )
        instances.push(posthog)
        return posthog
    }

    beforeEach(() => {
        localStorage.clear()
        document.cookie.split(';').forEach((c) => {
            document.cookie = c.replace(/=.*/, '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/')
        })
        createdManagers = []
        initConversations = vi.fn(() => {
            const manager = { reset: vi.fn(), show: vi.fn(), hide: vi.fn() }
            createdManagers.push(manager)
            return manager
        })
        assignableWindow.__PosthogExtensions__ = {
            ...assignableWindow.__PosthogExtensions__,
            initConversations,
        } as any
    })

    afterEach(async () => {
        await Promise.all(instances.splice(0).map((instance) => instance.shutdown(0)))
        delete (assignableWindow.__PosthogExtensions__ as any)?.initConversations
    })

    it('loads the widget when a cookieless visitor opts in', async () => {
        const posthog = await setup({ cookieless_mode: 'on_reject', opt_out_capturing_by_default: true })
        expect(initConversations).not.toHaveBeenCalled()
        expect(posthog.conversations.isAvailable()).toBe(false)

        posthog.opt_in_capturing()

        expect(initConversations).toHaveBeenCalledTimes(1)
        expect(posthog.conversations.isAvailable()).toBe(true)
    })

    it('starts a fresh widget session after reset() for an opted-in visitor', async () => {
        const posthog = await setup()
        expect(initConversations).toHaveBeenCalledTimes(1)

        posthog.reset()

        expect(createdManagers[0].reset).toHaveBeenCalledTimes(1)
        expect(initConversations).toHaveBeenCalledTimes(2)
        expect(posthog.conversations.isAvailable()).toBe(true)
    })

    it('waits for consent again after reset() clears it, then loads on opt-in', async () => {
        const posthog = await setup({ cookieless_mode: 'on_reject', opt_out_capturing_by_default: true })
        posthog.opt_in_capturing()
        expect(initConversations).toHaveBeenCalledTimes(1)

        posthog.reset()

        expect(posthog.has_opted_out_capturing()).toBe(true)
        expect(posthog.conversations.isAvailable()).toBe(false)
        expect(initConversations).toHaveBeenCalledTimes(1)

        posthog.opt_in_capturing()

        expect(initConversations).toHaveBeenCalledTimes(2)
        expect(posthog.conversations.isAvailable()).toBe(true)
    })

    it('does not load the widget when a visitor opts out', async () => {
        const posthog = await setup({ cookieless_mode: 'on_reject' })
        posthog.opt_in_capturing()
        expect(initConversations).toHaveBeenCalledTimes(1)

        posthog.opt_out_capturing()

        expect(posthog.conversations.isAvailable()).toBe(false)
        expect(initConversations).toHaveBeenCalledTimes(1)
    })
})
