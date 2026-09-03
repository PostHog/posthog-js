import { PostHogConversations, ConversationsManager } from '../../../extensions/conversations/posthog-conversations'
import { ConversationsRemoteConfig } from '../../../posthog-conversations-types'
import { PostHog } from '../../../posthog-core'
import { RemoteConfig } from '../../../types'
import { assignableWindow } from '../../../utils/globals'
import { createMockPostHog, createMockConfig, createMockPersistence } from '../../helpers/posthog-instance'

describe('Conversations Identity Verification', () => {
    let conversations: PostHogConversations
    let mockPostHog: PostHog
    let mockManager: ConversationsManager

    const remoteConfig: Partial<RemoteConfig> = {
        conversations: {
            enabled: true,
            token: 'test-conversations-token',
        } as ConversationsRemoteConfig,
    }

    beforeEach(() => {
        localStorage.clear()
        vi.clearAllMocks()

        mockManager = {
            show: vi.fn(),
            hide: vi.fn(),
            reset: vi.fn(),
            isVisible: vi.fn().mockReturnValue(true),
            sendMessage: vi.fn(),
            getMessages: vi.fn(),
            markAsRead: vi.fn(),
            getTickets: vi.fn(),
            requestRestoreLink: vi.fn(),
            restoreFromToken: vi.fn(),
            restoreFromUrlToken: vi.fn(),
            getCurrentTicketId: vi.fn(),
            getWidgetSessionId: vi.fn(),
            setIdentity: vi.fn(),
            clearIdentity: vi.fn(),
        } as unknown as ConversationsManager

        const config = createMockConfig({
            api_host: 'https://test.posthog.com',
            token: 'test-token',
            disable_conversations: false,
        })

        mockPostHog = createMockPostHog({
            config,
            persistence: createMockPersistence({
                props: {},
            }),
            requestRouter: {
                endpointFor: vi.fn().mockReturnValue('https://test.posthog.com/api/test'),
            } as any,
            consent: {
                isOptedOut: vi.fn().mockReturnValue(false),
            } as any,
            get_distinct_id: vi.fn().mockReturnValue('test-distinct-id'),
            on: vi.fn().mockReturnValue(vi.fn()),
            setIdentity: vi.fn((distinctId: string, hash: string) => {
                mockPostHog.config.identity_distinct_id = distinctId
                mockPostHog.config.identity_hash = hash
                ;(mockPostHog as any).conversations?._onIdentityChanged()
            }),
            clearIdentity: vi.fn(() => {
                delete mockPostHog.config.identity_distinct_id
                delete mockPostHog.config.identity_hash
                ;(mockPostHog as any).conversations?._onIdentityCleared()
            }),
        })

        assignableWindow.__PosthogExtensions__ = {
            initConversations: undefined,
            loadExternalDependency: vi.fn((_instance, _path, callback) => {
                assignableWindow.__PosthogExtensions__!.initConversations = vi.fn().mockReturnValue(mockManager)
                callback(null)
            }),
        }

        conversations = new PostHogConversations(mockPostHog)
        ;(mockPostHog as any).conversations = conversations
    })

    function loadConversations() {
        conversations.onRemoteConfig({ ok: true, config: remoteConfig as RemoteConfig })
    }

    describe('posthog.setIdentity', () => {
        it('should store identity on top-level config', () => {
            mockPostHog.setIdentity('user_123', 'a1b2c3d4')

            expect(mockPostHog.config.identity_distinct_id).toBe('user_123')
            expect(mockPostHog.config.identity_hash).toBe('a1b2c3d4')
        })

        it('should forward to manager via _onIdentityChanged when manager is loaded', () => {
            loadConversations()
            mockPostHog.setIdentity('user_123', 'a1b2c3d4')

            expect(mockManager.setIdentity).toHaveBeenCalled()
        })

        it('should store on config even when manager is not loaded yet', () => {
            mockPostHog.setIdentity('user_123', 'a1b2c3d4')

            expect(mockPostHog.config.identity_distinct_id).toBe('user_123')
            expect(mockPostHog.config.identity_hash).toBe('a1b2c3d4')
            expect(mockManager.setIdentity).not.toHaveBeenCalled()
        })

        it('should be read by manager when it loads later', () => {
            mockPostHog.setIdentity('user_123', 'a1b2c3d4')

            expect(mockPostHog.config.identity_distinct_id).toBe('user_123')

            loadConversations()

            expect(assignableWindow.__PosthogExtensions__!.initConversations).toHaveBeenCalled()
        })
    })

    describe('posthog.clearIdentity', () => {
        it('should remove identity from posthog.config', () => {
            mockPostHog.config.identity_distinct_id = 'user_123'
            mockPostHog.config.identity_hash = 'a1b2c3d4'
            mockPostHog.clearIdentity()

            expect(mockPostHog.config.identity_distinct_id).toBeUndefined()
            expect(mockPostHog.config.identity_hash).toBeUndefined()
        })

        it('should forward to manager via _onIdentityCleared when manager is loaded', () => {
            loadConversations()
            mockPostHog.clearIdentity()

            expect(mockManager.clearIdentity).toHaveBeenCalled()
        })

        it('should not throw when manager is not loaded', () => {
            expect(() => mockPostHog.clearIdentity()).not.toThrow()
        })
    })

    describe('reset', () => {
        it('should delegate reset to manager', () => {
            loadConversations()
            conversations.reset()

            expect(mockManager.reset).toHaveBeenCalled()
        })
    })

    describe('init-time identity config', () => {
        it('should pass through init config to manager construction', () => {
            mockPostHog.config.identity_distinct_id = 'user_123'
            mockPostHog.config.identity_hash = 'a1b2c3d4'

            loadConversations()

            expect(assignableWindow.__PosthogExtensions__!.initConversations).toHaveBeenCalled()
            expect(mockPostHog.config.identity_distinct_id).toBe('user_123')
        })

        it('should not interfere when no identity config is set', () => {
            expect(mockPostHog.config.identity_distinct_id).toBeUndefined()

            loadConversations()

            expect(assignableWindow.__PosthogExtensions__!.initConversations).toHaveBeenCalled()
            expect(mockPostHog.config.identity_distinct_id).toBeUndefined()
        })
    })
})
